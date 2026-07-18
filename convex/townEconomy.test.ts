import { readFileSync } from 'node:fs';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { residentEconomyProfiles } from '../data/worlds/lighthouse-town/economy';
import {
  appendEconomyLedger,
  initializeTownEconomy,
  MAX_ECONOMY_RECONCILIATION_ATTEMPTS,
  reconcileTownEconomyAfterAgentCreation,
  shanghaiEconomyDayKey,
} from './townEconomy';
import { MAX_MONEY, MAX_STOCK } from './townEconomyRules';

type StoredRow = Record<string, unknown> & { _id: string; _creationTime: number };

class MemoryDb {
  private nextId = 1;
  readonly rows = new Map<string, StoredRow[]>();

  seed(table: string, row: Record<string, unknown>) {
    const stored = {
      _id: `${table}:${this.nextId++}`,
      _creationTime: Date.now(),
      ...row,
    };
    this.table(table).push(stored);
    return stored;
  }

  query(table: string) {
    const filters: Array<[string, unknown]> = [];
    const query = {
      withIndex: (_index: string, apply: (builder: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
        const indexBuilder = {
          eq: (field: string, value: unknown) => {
            filters.push([field, value]);
            return indexBuilder;
          },
        };
        apply(indexBuilder);
        return query;
      },
      collect: () => Promise.resolve(this.matching(table, filters)),
      unique: () => {
        const rows = this.matching(table, filters);
        if (rows.length > 1) throw new Error(`Expected unique ${table} row`);
        return Promise.resolve(rows[0] ?? null);
      },
    };
    return query;
  }

  insert(table: string, row: Record<string, unknown>) {
    return Promise.resolve(this.seed(table, row)._id);
  }

  get(id: string) {
    for (const rows of this.rows.values()) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) return Promise.resolve(row);
    }
    return Promise.resolve(null);
  }

  table(name: string) {
    const existing = this.rows.get(name);
    if (existing) return existing;
    const created: StoredRow[] = [];
    this.rows.set(name, created);
    return created;
  }

  private matching(table: string, filters: Array<[string, unknown]>) {
    return this.table(table).filter((row) =>
      filters.every(([field, value]) => row[field] === value),
    );
  }
}

class MemoryScheduler {
  readonly calls: Array<{ delay: number; args: Record<string, unknown> }> = [];

  runAfter(delay: number, _reference: unknown, args: Record<string, unknown>) {
    this.calls.push({ delay, args });
    return Promise.resolve('scheduled:test');
  }
}

function makeContext() {
  const db = new MemoryDb();
  const scheduler = new MemoryScheduler();
  return { db, scheduler, ctx: { db, scheduler } as unknown as MutationCtx };
}

const worldId = 'worlds:test' as Id<'worlds'>;
const now = Date.parse('2026-07-19T09:30:00+08:00');

function seedRuntimeResidents(db: MemoryDb, profiles = residentEconomyProfiles) {
  profiles.forEach((profile) => {
    const index = residentEconomyProfiles.findIndex((entry) => entry.id === profile.id);
    addRuntimeResident(db, profile.name, `p:${index}`);
  });
}

function addRuntimeResident(
  db: MemoryDb,
  name: string,
  playerId: string,
  options: { human?: string; agent?: boolean } = {},
) {
  db.seed('playerDescriptions', { worldId, playerId, name });
  let world = db.table('worlds').find((row) => row._id === worldId);
  if (!world) {
    world = db.seed('worlds', {
      _id: worldId,
      nextId: 0,
      players: [],
      agents: [],
      conversations: [],
    });
  }
  (world.players as Array<Record<string, unknown>>).push({
    id: playerId,
    human: options.human,
  });
  if (options.agent !== false) {
    (world.agents as Array<Record<string, unknown>>).push({
      id: `a:${playerId.slice(2)}`,
      playerId,
    });
  }
}

function seedWorldStatus(db: MemoryDb, status: 'running' | 'stoppedByDeveloper' | 'inactive') {
  db.seed('worldStatus', {
    worldId,
    status,
    isDefault: true,
    engineId: 'engines:test',
    lastViewed: now,
  });
}

describe('town economy persistence', () => {
  test('declares resident, institution and immutable ledger tables with lookup indexes', () => {
    const schema = readFileSync('convex/schema.ts', 'utf8');
    expect(schema).toContain('residentEconomy: defineTable');
    expect(schema).toContain('townInstitutions: defineTable');
    expect(schema).toContain('economyLedger: defineTable');
    expect(schema).toContain(".index('resident', ['worldId', 'residentId'])");
    expect(schema).toContain(".index('institution', ['worldId', 'institutionId'])");
    expect(schema).toContain(".index('idempotencyKey', ['worldId', 'idempotencyKey'])");
    expect(schema).toContain(".index('day', ['worldId', 'dayKey', 'createdAt'])");
  });

  test('reconciles immediately and once more after asynchronous resident creation', () => {
    const initSource = readFileSync('convex/init.ts', 'utf8');
    expect(initSource).toContain('initializeTownEconomy(ctx, worldStatus.worldId)');
    expect(initSource).toContain('internal.init.reconcileTownEconomy');
    expect(initSource).toContain('economy.residentCount < Descriptions.length');
    expect(initSource.indexOf('const economy = await initializeTownEconomy')).toBeLessThan(
      initSource.indexOf('internal.init.reconcileTownEconomy'),
    );
    expect(initSource).toMatch(/export const reconcileTownEconomy\s*=\s*internalMutation/u);
  });

  test('initializes exactly nine runtime resident accounts and nine institutions once', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);

    const first = await initializeTownEconomy(ctx, worldId, now);
    const second = await initializeTownEconomy(ctx, worldId, now + 1_000);

    expect(first).toEqual({
      residentCount: 9,
      institutionCount: 9,
      missingResidentNames: [],
      conflictingResidentNames: [],
    });
    expect(second).toEqual(first);
    expect(db.table('residentEconomy')).toHaveLength(9);
    expect(db.table('townInstitutions')).toHaveLength(9);
    expect(new Set(db.table('residentEconomy').map((row) => row.residentId)).size).toBe(9);
  });

  test('fills a delayed runtime resident on a later idempotent reconciliation', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db, residentEconomyProfiles.slice(0, 8));

    const partial = await initializeTownEconomy(ctx, worldId, now);
    expect(partial.residentCount).toBe(8);
    expect(partial.missingResidentNames).toEqual(['玄微先生']);

    addRuntimeResident(db, '玄微先生', 'p:8');
    const complete = await initializeTownEconomy(ctx, worldId, now + 20_000);

    expect(complete.residentCount).toBe(9);
    expect(complete.missingResidentNames).toEqual([]);
    expect(db.table('residentEconomy')).toHaveLength(9);
    expect(db.table('townInstitutions')).toHaveLength(9);
  });

  test('retries with bounded backoff when residents appear later than the first delay', async () => {
    const { db, scheduler, ctx } = makeContext();
    seedWorldStatus(db, 'running');
    seedRuntimeResidents(db, residentEconomyProfiles.slice(0, 8));

    const first = await reconcileTownEconomyAfterAgentCreation(ctx, {
      worldId,
      attempt: 0,
      now,
    });
    expect(first).toMatchObject({ status: 'retrying', residentCount: 8, nextAttempt: 1 });
    expect(scheduler.calls).toEqual([
      { delay: 10_000, args: { worldId, attempt: 1 } },
    ]);

    addRuntimeResident(db, '玄微先生', 'p:8');
    const complete = await reconcileTownEconomyAfterAgentCreation(ctx, {
      worldId,
      attempt: 1,
      now: now + 30_000,
    });
    expect(complete).toMatchObject({ status: 'complete', residentCount: 9 });
    expect(scheduler.calls).toHaveLength(1);
  });

  test('stops reconciliation at its bound and never initializes a paused or foreign world', async () => {
    const bounded = makeContext();
    seedWorldStatus(bounded.db, 'running');
    seedRuntimeResidents(bounded.db, residentEconomyProfiles.slice(0, 3));
    const exhausted = await reconcileTownEconomyAfterAgentCreation(bounded.ctx, {
      worldId,
      attempt: MAX_ECONOMY_RECONCILIATION_ATTEMPTS,
      now,
    });
    expect(exhausted).toMatchObject({ status: 'exhausted', residentCount: 3 });
    expect(bounded.scheduler.calls).toHaveLength(0);

    const stopped = makeContext();
    seedWorldStatus(stopped.db, 'stoppedByDeveloper');
    seedRuntimeResidents(stopped.db);
    expect(await reconcileTownEconomyAfterAgentCreation(stopped.ctx, {
      worldId,
      attempt: 0,
      now,
    })).toEqual({ status: 'world-not-running' });
    expect(stopped.db.table('residentEconomy')).toHaveLength(0);
    expect(stopped.db.table('townInstitutions')).toHaveLength(0);
    expect(stopped.scheduler.calls).toHaveLength(0);

    const missingWorld = makeContext();
    seedRuntimeResidents(missingWorld.db);
    expect(await reconcileTownEconomyAfterAgentCreation(missingWorld.ctx, {
      worldId,
      attempt: 0,
      now,
    })).toEqual({ status: 'world-not-running' });
    expect(missingWorld.db.table('residentEconomy')).toHaveLength(0);
  });

  test('maps only one active nonhuman agent per profile and surfaces identity conflicts', async () => {
    const { db, ctx } = makeContext();
    addRuntimeResident(db, '林澜', 'p:0');
    addRuntimeResident(db, '沈砚', 'p:1');
    addRuntimeResident(db, '沈砚', 'p:2');
    addRuntimeResident(db, '唐果', 'p:3', { human: '' });
    db.seed('playerDescriptions', { worldId, playerId: 'p:99', name: '墨七' });
    addRuntimeResident(db, '苏萤', 'p:4');
    db.seed('playerDescriptions', { worldId, playerId: 'p:4', name: '白露' });

    const result = await initializeTownEconomy(ctx, worldId, now);

    expect(result.residentCount).toBe(1);
    expect(result.conflictingResidentNames).toEqual(['沈砚', '苏萤', '白露']);
    expect(result.missingResidentNames).toEqual(expect.arrayContaining(['唐果', '墨七']));
    expect(db.table('residentEconomy').map((row) => row.profileId)).toEqual(['lin-lan']);
  });

  test('fails closed on duplicate, stale, out-of-range or malformed persisted state', async () => {
    const duplicate = makeContext();
    seedRuntimeResidents(duplicate.db);
    duplicate.db.seed('residentEconomy', validResidentRow({ residentId: 'p:0', profileId: 'lin-lan' }));
    duplicate.db.seed('residentEconomy', validResidentRow({ residentId: 'p:0', profileId: 'lin-lan' }));
    await expect(initializeTownEconomy(duplicate.ctx, worldId, now)).rejects.toThrow(/duplicate.*profile/iu);

    const stale = makeContext();
    seedRuntimeResidents(stale.db);
    stale.db.seed('residentEconomy', validResidentRow({ residentId: 'p:8', profileId: 'lin-lan' }));
    await expect(initializeTownEconomy(stale.ctx, worldId, now)).rejects.toThrow(/runtime mapping/u);

    const invalidBalance = makeContext();
    seedRuntimeResidents(invalidBalance.db);
    invalidBalance.db.seed('residentEconomy', validResidentRow({ balance: -1 }));
    await expect(initializeTownEconomy(invalidBalance.ctx, worldId, now)).rejects.toThrow(/balance/u);

    const invalidDay = makeContext();
    seedRuntimeResidents(invalidDay.db);
    invalidDay.db.seed('residentEconomy', validResidentRow({ dayKey: '2026-02-31' }));
    await expect(initializeTownEconomy(invalidDay.ctx, worldId, now)).rejects.toThrow(/dayKey/u);

    const malformedInstitution = makeContext();
    seedRuntimeResidents(malformedInstitution.db);
    malformedInstitution.db.seed('townInstitutions', validInstitutionRow({
      institutionId: 'workshop',
      stockJson: '{bad-json',
    }));
    await expect(initializeTownEconomy(malformedInstitution.ctx, worldId, now)).rejects.toThrow(/stockJson/u);

    const wrongService = makeContext();
    seedRuntimeResidents(wrongService.db);
    wrongService.db.seed('townInstitutions', validInstitutionRow({
      institutionId: 'workshop',
      stockJson: JSON.stringify({ 'craft-service': 99 }),
      initialStockJson: JSON.stringify({ 'craft-service': 99 }),
      serviceCountersJson: JSON.stringify({ repair: 0, consultation: 0 }),
      initialServiceCountersJson: JSON.stringify({ repair: 0, consultation: 0 }),
    }));
    await expect(initializeTownEconomy(wrongService.ctx, worldId, now)).rejects.toThrow(/serviceCountersJson/u);
  });

  test('stores factual daily flow, offered stock and service counters separately', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);

    expect(db.table('residentEconomy')[0]).toEqual(expect.objectContaining({
      profileId: 'lin-lan',
      balance: 120,
      initialBalance: 120,
      initializationSourceKey: 'economy-definition:resident:lin-lan:v1',
      initializedAt: now,
      hunger: 100,
      energy: 100,
      todayIncome: 0,
      todayExpense: 0,
      dayKey: '2026-07-19',
      updatedAt: now,
    }));
    const workshop = db.table('townInstitutions').find((row) => row.institutionId === 'workshop');
    expect(workshop).toEqual(expect.objectContaining({
      cash: 120,
      initialCash: 120,
      stockJson: JSON.stringify({ 'craft-service': 99 }),
      initialStockJson: JSON.stringify({ 'craft-service': 99 }),
      serviceCountersJson: JSON.stringify({ repair: 0, 'lantern-making': 0 }),
      initialServiceCountersJson: JSON.stringify({ repair: 0, 'lantern-making': 0 }),
      initializationSourceKey: 'economy-definition:institution:workshop:v1',
      initializedAt: now,
      todayIncome: 0,
      todayExpense: 0,
      visitorCount: 0,
      dayKey: '2026-07-19',
      updatedAt: now,
    }));
    for (const row of [...db.table('residentEconomy'), ...db.table('townInstitutions')]) {
      for (const field of ['balance', 'cash', 'hunger', 'energy', 'todayIncome', 'todayExpense', 'visitorCount']) {
        if (row[field] !== undefined) {
          expect(Number.isSafeInteger(row[field])).toBe(true);
          expect(row[field]).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(db.table('economyLedger')).toHaveLength(0);
  });

  test('appends one immutable factual ledger row per stable idempotency key', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);
    const entry = {
      worldId,
      idempotencyKey: 'work:worlds:test:p:2:o:4',
      dayKey: shanghaiEconomyDayKey(now),
      residentId: 'p:2',
      institutionId: 'tea-house',
      kind: 'work' as const,
      amount: 16,
      item: 'tea',
      quantity: 3,
      expectedAmount: 16,
      sourceKey: 'activity:o:4',
      text: '唐果完成一次茶叶备货，实际支取 16 金贝。',
      createdAt: now,
    };

    expect(await appendEconomyLedger(ctx, entry)).toBe(true);
    expect(await appendEconomyLedger(ctx, { ...entry })).toBe(false);
    await expect(appendEconomyLedger(ctx, {
      ...entry,
      amount: 15,
      text: '虚构改写',
    })).rejects.toThrow(/idempotencyKey collision/u);
    expect(db.table('economyLedger')).toHaveLength(1);
    expect(db.table('economyLedger')[0]).toEqual(expect.objectContaining(entry));
  });

  test('rejects malformed or non-factual ledger values before persistence', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);
    const base = {
      worldId,
      idempotencyKey: 'reward:2026-07-19:p:1',
      dayKey: '2026-07-19',
      residentId: 'p:1',
      kind: 'event-reward' as const,
      amount: 10,
      sourceKey: 'daily-event:2026-07-19:participation:p:1',
      text: '居民完成当日活动，实际获得 10 金贝。',
      createdAt: now,
    };

    await expect(appendEconomyLedger(ctx, { ...base, amount: -1 })).rejects.toThrow(/amount/u);
    await expect(appendEconomyLedger(ctx, { ...base, amount: 1.5 })).rejects.toThrow(/amount/u);
    await expect(appendEconomyLedger(ctx, { ...base, amount: MAX_MONEY + 1 })).rejects.toThrow(/amount/u);
    await expect(appendEconomyLedger(ctx, { ...base, quantity: 0 })).rejects.toThrow(/quantity/u);
    await expect(appendEconomyLedger(ctx, { ...base, quantity: MAX_STOCK + 1 })).rejects.toThrow(/quantity/u);
    await expect(appendEconomyLedger(ctx, { ...base, dayKey: '2026-07-18' })).rejects.toThrow(/dayKey/u);
    await expect(appendEconomyLedger(ctx, { ...base, sourceKey: '   ' })).rejects.toThrow(/sourceKey/u);
    expect(db.table('economyLedger')).toHaveLength(0);
  });

  test('accepts an explicitly attempted but unpaid work fact without inventing wages', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);
    expect(await appendEconomyLedger(ctx, {
      worldId,
      idempotencyKey: 'work:worlds:test:p:2:o:unpaid',
      dayKey: '2026-07-19',
      residentId: 'p:2',
      institutionId: 'tea-house',
      kind: 'work',
      amount: 0,
      expectedAmount: 16,
      item: 'tea',
      quantity: 3,
      sourceKey: 'activity:o:unpaid',
      text: '完成备货，机构本次未能支付。',
      createdAt: now,
    })).toBe(true);
    expect(db.table('economyLedger')[0]).toEqual(expect.objectContaining({
      amount: 0,
      expectedAmount: 16,
    }));
  });

  test('enforces work ownership and its explicit compensation attempt', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);
    const work = {
      worldId,
      idempotencyKey: 'work:worlds:test:p:2:o:5',
      dayKey: '2026-07-19',
      residentId: 'p:2',
      institutionId: 'tea-house',
      kind: 'work' as const,
      amount: 16,
      expectedAmount: 16,
      item: 'tea',
      quantity: 3,
      sourceKey: 'activity:o:5',
      text: '完成一次茶叶备货。',
      createdAt: now,
    };
    expect(await appendEconomyLedger(ctx, work)).toBe(true);
    await expect(appendEconomyLedger(ctx, {
      ...work,
      idempotencyKey: 'work:wrong-institution',
      institutionId: 'restaurant',
    })).rejects.toThrow(/work institution/u);
    await expect(appendEconomyLedger(ctx, {
      ...work,
      idempotencyKey: 'work:wrong-output',
      item: 'meal',
    })).rejects.toThrow(/work output/u);
    await expect(appendEconomyLedger(ctx, {
      ...work,
      idempotencyKey: 'work:missing-attempt',
      expectedAmount: undefined,
    })).rejects.toThrow(/expectedAmount/u);
    await expect(appendEconomyLedger(ctx, {
      ...work,
      idempotencyKey: 'work:overpayment',
      amount: 17,
    })).rejects.toThrow(/work amount/u);
  });

  test('validates purchases and rewards from structured state instead of prose', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);
    const purchase = {
      worldId,
      idempotencyKey: 'purchase:worlds:test:p:1:o:7',
      dayKey: '2026-07-19',
      residentId: 'p:1',
      institutionId: 'tea-house',
      kind: 'purchase' as const,
      amount: 4,
      item: 'tea',
      quantity: 1,
      sourceKey: 'activity:o:7',
      text: '这段说明不能改变实际价格。',
      createdAt: now,
    };
    expect(await appendEconomyLedger(ctx, purchase)).toBe(true);
    await expect(appendEconomyLedger(ctx, {
      ...purchase,
      idempotencyKey: 'purchase:wrong-price',
      amount: 5,
    })).rejects.toThrow(/purchase amount/u);
    await expect(appendEconomyLedger(ctx, {
      ...purchase,
      idempotencyKey: 'purchase:wrong-item',
      item: 'medicine',
      amount: 10,
    })).rejects.toThrow(/purchase item/u);

    const reward = {
      worldId,
      idempotencyKey: 'reward:2026-07-19:p:1:participation',
      dayKey: '2026-07-19',
      residentId: 'p:1',
      kind: 'event-reward' as const,
      amount: 10,
      sourceKey: 'daily-event:2026-07-19:participation:p:1',
      text: '实际发放参与奖励。',
      createdAt: now,
    };
    expect(await appendEconomyLedger(ctx, reward)).toBe(true);
    await expect(appendEconomyLedger(ctx, {
      ...reward,
      idempotencyKey: 'reward:zero',
      amount: 0,
    })).rejects.toThrow(/event reward amount/u);
    await expect(appendEconomyLedger(ctx, {
      ...reward,
      idempotencyKey: 'reward:unknown-resident',
      residentId: 'p:99',
    })).rejects.toThrow(/resident account/u);
  });

  test('validates restock goods and event services against institution definitions', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);
    const restock = {
      worldId,
      idempotencyKey: 'restock:2026-07-19:tea-house:tea',
      dayKey: '2026-07-19',
      institutionId: 'tea-house',
      kind: 'restock' as const,
      amount: 2,
      item: 'tea',
      quantity: 4,
      sourceKey: 'daily-restock:2026-07-19:tea-house:tea',
      text: '实际补入四份茶点原料。',
      createdAt: now,
    };
    expect(await appendEconomyLedger(ctx, restock)).toBe(true);
    await expect(appendEconomyLedger(ctx, {
      ...restock,
      idempotencyKey: 'restock:wrong-item',
      item: 'medicine',
    })).rejects.toThrow(/restock item/u);

    const eventService = {
      worldId,
      idempotencyKey: 'event-service:2026-07-19:p:0:tower-guidance',
      dayKey: '2026-07-19',
      residentId: 'p:0',
      institutionId: 'town-office',
      kind: 'event-service' as const,
      amount: 6,
      item: 'tower-guidance',
      quantity: 1,
      sourceKey: 'daily-event:2026-07-19:host-service:p:0',
      text: '实际完成一次活动讲解服务。',
      createdAt: now,
    };
    expect(await appendEconomyLedger(ctx, eventService)).toBe(true);
    await expect(appendEconomyLedger(ctx, {
      ...eventService,
      idempotencyKey: 'event-service:wrong-service',
      item: 'repair',
    })).rejects.toThrow(/event service/u);
  });

  test('requires bounded canonical ASCII source and idempotency keys', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);
    const reward = {
      worldId,
      idempotencyKey: 'reward:2026-07-19:p:1',
      dayKey: '2026-07-19',
      residentId: 'p:1',
      kind: 'event-reward' as const,
      amount: 10,
      sourceKey: 'daily-event:2026-07-19:participation:p:1',
      text: '实际发奖。',
      createdAt: now,
    };
    for (const [field, value] of [
      ['idempotencyKey', '奖励:一'],
      ['idempotencyKey', 'has space'],
      ['idempotencyKey', `reward:${'x'.repeat(200)}`],
      ['sourceKey', 'Daily-Event:UPPER'],
      ['sourceKey', 'source/with/slash'],
    ] as const) {
      await expect(appendEconomyLedger(ctx, { ...reward, [field]: value })).rejects.toThrow(
        new RegExp(field),
      );
    }
    expect(db.table('economyLedger')).toHaveLength(0);
  });

  test('throws on an idempotency collision unless every factual field is equivalent', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);
    const reward = {
      worldId,
      idempotencyKey: 'reward:2026-07-19:p:1',
      dayKey: '2026-07-19',
      residentId: 'p:1',
      kind: 'event-reward' as const,
      amount: 10,
      sourceKey: 'daily-event:2026-07-19:participation:p:1',
      text: '实际发奖。',
      createdAt: now,
    };
    expect(await appendEconomyLedger(ctx, reward)).toBe(true);
    db.table('residentEconomy').splice(0);
    expect(await appendEconomyLedger(ctx, { ...reward })).toBe(false);
    await expect(appendEconomyLedger(ctx, { ...reward, amount: 30 })).rejects.toThrow(
      /idempotencyKey collision/u,
    );
    await expect(appendEconomyLedger(ctx, { ...reward, text: '另一段说明' })).rejects.toThrow(
      /idempotencyKey collision/u,
    );
    expect(db.table('economyLedger')).toHaveLength(1);
  });

  test('rejects timestamps outside the JavaScript date range and oversized factual text', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);
    const reward = {
      worldId,
      idempotencyKey: 'reward:2026-07-19:p:1',
      dayKey: '2026-07-19',
      residentId: 'p:1',
      kind: 'event-reward' as const,
      amount: 10,
      sourceKey: 'daily-event:2026-07-19:participation:p:1',
      text: '实际发奖。',
      createdAt: now,
    };
    await expect(appendEconomyLedger(ctx, {
      ...reward,
      idempotencyKey: 'reward:date-overflow',
      createdAt: 8_640_000_000_000_001,
    })).rejects.toThrow(/createdAt/u);
    await expect(appendEconomyLedger(ctx, {
      ...reward,
      idempotencyKey: 'reward:text-overflow',
      text: '事'.repeat(501),
    })).rejects.toThrow(/text/u);
    expect(db.table('economyLedger')).toHaveLength(0);
  });
});

function validResidentRow(overrides: Record<string, unknown> = {}) {
  return {
    worldId,
    residentId: 'p:0',
    profileId: 'lin-lan',
    balance: 120,
    initialBalance: 120,
    hunger: 100,
    energy: 100,
    todayIncome: 0,
    todayExpense: 0,
    dayKey: '2026-07-19',
    initializationSourceKey: 'economy-definition:resident:lin-lan:v1',
    initializedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function validInstitutionRow(overrides: Record<string, unknown> = {}) {
  return {
    worldId,
    institutionId: 'tea-house',
    cash: 120,
    initialCash: 120,
    stockJson: JSON.stringify({ tea: 12 }),
    initialStockJson: JSON.stringify({ tea: 12 }),
    serviceCountersJson: '{}',
    initialServiceCountersJson: '{}',
    todayIncome: 0,
    todayExpense: 0,
    visitorCount: 0,
    dayKey: '2026-07-19',
    initializationSourceKey: 'economy-definition:institution:tea-house:v1',
    initializedAt: now,
    updatedAt: now,
    ...overrides,
  };
}
