import { readFileSync } from 'node:fs';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { residentEconomyProfiles } from '../data/worlds/lighthouse-town/economy';
import {
  appendEconomyLedger,
  advanceDailyEconomy,
  advanceDailyEconomyForWorldNow,
  dispatchDailyEconomyPage,
  initializeTownEconomy,
  MAX_ECONOMY_RECONCILIATION_ATTEMPTS,
  reconcileTownEconomyAfterAgentCreation,
  shanghaiEconomyDayKey,
  settleActivity,
  validateActivityRegistration,
} from './townEconomy';
import {
  applyCompletedActivityRegistrationAcks,
  chooseResidentActivityWithLocalModel,
  dispatchActivityRegistrationAckWithRecovery,
  enqueueResidentActivityInput,
  pendingResidentActivitySettlementForResident,
  persistActivitySettlementRetryState,
  processActivityRegistrationAckOutbox,
  recordActivityRegistrationAckFailure,
  wakeOutstandingActivitySettlements,
} from './aiTown/agentOperations';
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
    let order: 'asc' | 'desc' = 'asc';
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
      paginate: ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
        const rows = this.matching(table, filters);
        const offset = cursor === null ? 0 : Number(cursor.slice('offset:'.length));
        const page = rows.slice(offset, offset + numItems);
        const nextOffset = offset + page.length;
        return Promise.resolve({
          page,
          isDone: nextOffset >= rows.length,
          continueCursor: `offset:${nextOffset}`,
        });
      },
      take: (count: number) => Promise.resolve(this.matching(table, filters).slice(0, count)),
      order: (direction: 'asc' | 'desc') => {
        order = direction;
        return query;
      },
      first: () => {
        const rows = this.matching(table, filters);
        return Promise.resolve((order === 'desc' ? rows.at(-1) : rows[0]) ?? null);
      },
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

  patch(id: string, value: Record<string, unknown>) {
    for (const rows of this.rows.values()) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) {
        Object.assign(row, value);
        return Promise.resolve();
      }
    }
    throw new Error(`Missing row ${id}`);
  }

  table(name: string) {
    const existing = this.rows.get(name);
    if (existing) return existing;
    const created: StoredRow[] = [];
    this.rows.set(name, created);
    return created;
  }

  snapshot() {
    return structuredClone([...this.rows.entries()]);
  }

  restore(snapshot: Array<[string, StoredRow[]]>) {
    this.rows.clear();
    for (const [table, rows] of snapshot) this.rows.set(table, rows);
  }

  private matching(table: string, filters: Array<[string, unknown]>) {
    return this.table(table).filter((row) =>
      filters.every(([field, value]) => row[field] === value),
    );
  }
}

class MemoryScheduler {
  readonly calls: Array<{ delay: number; args: Record<string, unknown> }> = [];
  failNext = false;

  runAfter(delay: number, _reference: unknown, args: Record<string, unknown>) {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('scheduler-unavailable'));
    }
    this.calls.push({ delay, args });
    return Promise.resolve('scheduled:test');
  }
}

function makeContext() {
  const db = new MemoryDb();
  const scheduler = new MemoryScheduler();
  return { db, scheduler, ctx: { db, scheduler } as unknown as MutationCtx };
}

async function runMemoryMutation<T>(
  fixture: ReturnType<typeof makeContext>,
  mutation: () => Promise<T>,
) {
  const dbSnapshot = fixture.db.snapshot();
  const schedulerCallCount = fixture.scheduler.calls.length;
  try {
    return await mutation();
  } catch (error) {
    fixture.db.restore(dbSnapshot);
    fixture.scheduler.calls.splice(schedulerCallCount);
    throw error;
  }
}

async function makeLinkedActivityFixture(operationId: string) {
  const fixture = makeContext();
  seedWorldStatus(fixture.db, 'running');
  addRuntimeResident(fixture.db, '唐果', 'p:2');
  const base = workSettlementArgs();
  const queued = await enqueueResidentActivityInput(fixture.ctx, {
    worldId,
    residentId: base.residentId,
    agentId: 'a:2',
    operationId,
    activityText: base.activityText,
    activityDuration: 60_000,
    landmarkId: base.landmarkId,
    category: base.category,
    economicAction: base.economicAction,
    startedAt: now,
    destination: { x: 5, y: 20 },
  });
  return {
    fixture,
    queued,
    registration: fixture.db.table('activityRegistrations')[0],
  };
}

async function expectInvalidAckTerminal(
  operationId: string,
  expectedReason: string,
  makeReturnValue: (registration: StoredRow) => { kind: string; value?: unknown },
) {
  const { fixture, queued, registration } = await makeLinkedActivityFixture(operationId);
  const completedInput = {
    inputId: queued.inputId as Id<'inputs'>,
    returnValue: makeReturnValue(registration),
  };
  const persisted = await applyCompletedActivityRegistrationAcks(
    fixture.ctx,
    worldId,
    [completedInput],
  );
  expect(persisted[0]?.status).toBe('persisted');
  const outbox = fixture.db.table('activityRegistrationAcks')[0];
  expect(outbox).toEqual(expect.objectContaining({
    ackKind: 'invalid-ack',
    status: 'pending',
  }));
  expect(JSON.parse(outbox.payloadJson as string)).toEqual({ reason: expectedReason });
  expect(registration).toEqual(expect.objectContaining({
    state: 'intent',
    deliveryState: 'processing',
  }));
  const scheduledBeforeProcessing = fixture.scheduler.calls.length;
  expect(await processActivityRegistrationAckOutbox(fixture.ctx, {
    outboxId: outbox._id as Id<'activityRegistrationAcks'>,
  })).toEqual({ status: 'dead-letter', reason: 'invalid-ack' });
  expect(outbox).toEqual(expect.objectContaining({
    status: 'dead-letter',
    errorCode: 'ack-processing-failed',
  }));
  expect(registration).toEqual(expect.objectContaining({
    state: 'abandoned',
    deliveryState: 'failed',
    abandonReason: 'ack-processing-failed',
  }));
  expect(fixture.db.table('lifeEvents')).toHaveLength(0);
  expect(fixture.db.table('economyLedger')).toHaveLength(0);
  expect(fixture.scheduler.calls).toHaveLength(scheduledBeforeProcessing);
  const replay = await applyCompletedActivityRegistrationAcks(
    fixture.ctx,
    worldId,
    [completedInput],
  );
  expect(replay[0]?.status).toBe('already-persisted');
  expect(fixture.scheduler.calls).toHaveLength(scheduledBeforeProcessing);
}

const worldId = 'worlds:test' as Id<'worlds'>;
const now = Date.parse('2026-07-19T09:30:00+08:00');

function seedRuntimeResidents(
  db: MemoryDb,
  profiles = residentEconomyProfiles,
  targetWorldId = worldId,
) {
  profiles.forEach((profile) => {
    const index = residentEconomyProfiles.findIndex((entry) => entry.id === profile.id);
    addRuntimeResident(db, profile.name, `p:${index}`, {}, targetWorldId);
  });
}

function addRuntimeResident(
  db: MemoryDb,
  name: string,
  playerId: string,
  options: { human?: string; agent?: boolean } = {},
  targetWorldId = worldId,
) {
  db.seed('playerDescriptions', { worldId: targetWorldId, playerId, name });
  let world = db.table('worlds').find((row) => row._id === targetWorldId);
  if (!world) {
    world = db.seed('worlds', {
      _id: targetWorldId,
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

function seedWorldStatus(
  db: MemoryDb,
  status: 'running' | 'stoppedByDeveloper' | 'inactive',
  targetWorldId = worldId,
) {
  db.seed('worldStatus', {
    worldId: targetWorldId,
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
    expect(schema).toContain('activityRegistrationAcks: defineTable');
    expect(schema).toContain(".index('worldTime', ['worldId', 'dayKey'])");
    expect(schema).toContain(".index('input', ['worldId', 'inputId'])");
    expect(schema).toContain(".index('resident', ['worldId', 'residentId'])");
    expect(schema).toContain(".index('institution', ['worldId', 'institutionId'])");
    expect(schema).toContain(".index('idempotencyKey', ['worldId', 'idempotencyKey'])");
    expect(schema).toContain(".index('day', ['worldId', 'dayKey', 'createdAt'])");
    expect(schema).toContain('initialBalance: v.optional(v.number())');
    expect(schema).toContain('initialCash: v.optional(v.number())');
    expect(schema).toContain('initializationSourceKey: v.optional(v.string())');
  });

  test('backfills legacy baseline fields deterministically without duplicating state', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    const resident = db.seed('residentEconomy', validResidentRow());
    const institution = db.seed('townInstitutions', validInstitutionRow());
    resident._creationTime = now - 1_000;
    institution._creationTime = now - 1_000;
    for (const field of ['initialBalance', 'initializationSourceKey', 'initializedAt']) {
      delete (resident as Record<string, unknown>)[field];
    }
    for (const field of [
      'initialCash', 'initialStockJson', 'initialServiceCountersJson',
      'initializationSourceKey', 'initializedAt',
    ]) {
      delete (institution as Record<string, unknown>)[field];
    }

    await initializeTownEconomy(ctx, worldId, now + 60_000);

    expect(resident).toEqual(expect.objectContaining({
      initialBalance: 120,
      initializationSourceKey: 'economy-definition:resident:lin-lan:v1',
      initializedAt: resident._creationTime,
    }));
    expect(institution).toEqual(expect.objectContaining({
      initialCash: 120,
      initialStockJson: JSON.stringify({ tea: 12 }),
      initialServiceCountersJson: '{}',
      initializationSourceKey: 'economy-definition:institution:tea-house:v1',
      initializedAt: institution._creationTime,
    }));
    expect(db.table('residentEconomy')).toHaveLength(9);
    expect(db.table('townInstitutions')).toHaveLength(9);
    expect(db.table('economyLedger')).toHaveLength(0);
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

    const mismatchedDay = makeContext();
    seedRuntimeResidents(mismatchedDay.db);
    mismatchedDay.db.seed('residentEconomy', validResidentRow({ dayKey: '2026-07-18' }));
    await expect(initializeTownEconomy(mismatchedDay.ctx, worldId, now)).rejects.toThrow(
      /dayKey.*updatedAt/iu,
    );

    const mismatchedInstitutionDay = makeContext();
    seedRuntimeResidents(mismatchedInstitutionDay.db);
    mismatchedInstitutionDay.db.seed(
      'townInstitutions',
      validInstitutionRow({ dayKey: '2026-07-18' }),
    );
    await expect(
      initializeTownEconomy(mismatchedInstitutionDay.ctx, worldId, now),
    ).rejects.toThrow(/dayKey.*updatedAt/iu);

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

  test('advances each running Shanghai day once and catches up after a delayed tick', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    seedRuntimeResidents(fixture.db);
    await initializeTownEconomy(fixture.ctx, worldId, now);
    const firstNextDay = Date.parse('2026-07-20T00:01:00+08:00');

    expect(await advanceDailyEconomy(fixture.ctx, firstNextDay)).toEqual({
      advancedWorlds: 1,
      advancedInstitutions: 9,
    });
    expect(await advanceDailyEconomy(fixture.ctx, firstNextDay + 8 * 60 * 60 * 1_000)).toEqual({
      advancedWorlds: 0,
      advancedInstitutions: 0,
    });
    expect(fixture.db.table('economyLedger').filter((row) => row.kind === 'restock'))
      .toHaveLength(9);
    expect(fixture.db.table('residentEconomy')).toEqual(expect.arrayContaining([
      expect.objectContaining({ todayIncome: 0, todayExpense: 0, dayKey: '2026-07-20' }),
    ]));

    const delayedTick = Date.parse('2026-07-23T17:00:00+08:00');
    expect(await advanceDailyEconomy(fixture.ctx, delayedTick)).toEqual({
      advancedWorlds: 1,
      advancedInstitutions: 9,
    });
    expect(fixture.db.table('economyLedger').filter((row) => row.kind === 'restock'))
      .toHaveLength(18);
    expect(new Set(fixture.db.table('townInstitutions').map((row) => row.dayKey)))
      .toEqual(new Set(['2026-07-23']));
  });

  test('never rolls daily economy backward when an older midnight tick arrives after a newer day', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    seedRuntimeResidents(fixture.db);
    await initializeTownEconomy(fixture.ctx, worldId, now);
    const newerTick = Date.parse('2026-07-20T00:01:00+08:00');
    const olderTick = Date.parse('2026-07-19T23:59:00+08:00');
    expect(await advanceDailyEconomy(fixture.ctx, newerTick)).toEqual({
      advancedWorlds: 1,
      advancedInstitutions: 9,
    });
    const afterNewerTick = {
      residents: structuredClone(fixture.db.table('residentEconomy')),
      institutions: structuredClone(fixture.db.table('townInstitutions')),
      ledger: structuredClone(fixture.db.table('economyLedger')),
      markers: structuredClone(fixture.db.table('dailyEconomyDays')),
    };

    expect(await advanceDailyEconomy(fixture.ctx, olderTick)).toEqual({
      advancedWorlds: 0,
      advancedInstitutions: 0,
    });
    expect(fixture.db.table('residentEconomy')).toEqual(afterNewerTick.residents);
    expect(fixture.db.table('townInstitutions')).toEqual(afterNewerTick.institutions);
    expect(fixture.db.table('economyLedger')).toEqual(afterNewerTick.ledger);
    expect(fixture.db.table('dailyEconomyDays')).toEqual(afterNewerTick.markers);
    expect(afterNewerTick.markers.map((marker) => marker.dayKey)).toEqual(['2026-07-20']);
  });

  test('stale per-world tick does not repair missing economy state before returning', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    seedRuntimeResidents(fixture.db);
    await initializeTownEconomy(fixture.ctx, worldId, now);
    const newerTick = Date.parse('2026-07-20T00:01:00+08:00');
    const olderTick = Date.parse('2026-07-19T23:59:00+08:00');
    expect(await advanceDailyEconomyForWorldNow(fixture.ctx, {
      worldId,
      now: newerTick,
    })).toEqual({ status: 'advanced', advancedInstitutions: 9 });
    fixture.db.table('residentEconomy').splice(0, 1);
    const beforeStaleTick = fixture.db.snapshot();

    expect(await advanceDailyEconomyForWorldNow(fixture.ctx, {
      worldId,
      now: olderTick,
    })).toEqual({ status: 'stale', advancedInstitutions: 0 });
    expect(fixture.db.snapshot()).toEqual(beforeStaleTick);
  });

  test('uses an independent daily marker instead of institution counter day keys', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    seedRuntimeResidents(fixture.db);
    await initializeTownEconomy(fixture.ctx, worldId, now);

    expect(new Set(fixture.db.table('townInstitutions').map((row) => row.dayKey)))
      .toEqual(new Set(['2026-07-19']));
    expect(await advanceDailyEconomy(fixture.ctx, now)).toEqual({
      advancedWorlds: 1,
      advancedInstitutions: 9,
    });
    expect(fixture.db.table('economyLedger').filter((row) => row.kind === 'restock'))
      .toHaveLength(9);
    expect(fixture.db.table('townInstitutions')).toEqual(expect.arrayContaining([
      expect.objectContaining({ cash: 118, todayExpense: 2 }),
    ]));
  });

  test('does not advance or restock a paused world', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'inactive');
    seedRuntimeResidents(fixture.db);
    await initializeTownEconomy(fixture.ctx, worldId, now);
    const before = fixture.db.snapshot();

    expect(await advanceDailyEconomy(
      fixture.ctx,
      Date.parse('2026-07-20T00:01:00+08:00'),
    )).toEqual({ advancedWorlds: 0, advancedInstitutions: 0 });
    expect(fixture.db.snapshot()).toEqual(before);
  });

  test('dispatches sixty-five running worlds over bounded status pages and skips paused worlds', async () => {
    const fixture = makeContext();
    const runningWorldIds = Array.from(
      { length: 65 },
      (_, index) => `worlds:page:${index}` as Id<'worlds'>,
    );
    for (const runningWorldId of runningWorldIds) {
      seedWorldStatus(fixture.db, 'running', runningWorldId);
    }
    const pausedWorldId = 'worlds:page:paused' as Id<'worlds'>;
    seedWorldStatus(fixture.db, 'inactive', pausedWorldId);

    const scheduledWorldIds: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    while (true) {
      const callOffset = fixture.scheduler.calls.length;
      const result = await dispatchDailyEconomyPage(fixture.ctx, { cursor, now });
      pages += 1;
      const calls = fixture.scheduler.calls.slice(callOffset);
      scheduledWorldIds.push(...calls.flatMap((call) =>
        typeof call.args.worldId === 'string' ? [call.args.worldId] : [],
      ));
      if (result.done) break;
      const continuation = calls.find((call) => typeof call.args.cursor === 'string');
      expect(continuation).toBeDefined();
      cursor = continuation!.args.cursor as string;
    }

    expect(pages).toBe(3);
    expect(scheduledWorldIds).toEqual(runningWorldIds);
    expect(scheduledWorldIds).not.toContain(pausedWorldId);
  });

  test('isolates a corrupt running world while a healthy world advances and a paused world skips', async () => {
    const fixture = makeContext();
    const corruptWorldId = 'worlds:corrupt' as Id<'worlds'>;
    const healthyWorldId = 'worlds:healthy' as Id<'worlds'>;
    const pausedWorldId = 'worlds:paused' as Id<'worlds'>;
    for (const runningWorldId of [corruptWorldId, healthyWorldId]) {
      seedWorldStatus(fixture.db, 'running', runningWorldId);
      seedRuntimeResidents(fixture.db, residentEconomyProfiles, runningWorldId);
      await initializeTownEconomy(fixture.ctx, runningWorldId, now);
    }
    seedWorldStatus(fixture.db, 'inactive', pausedWorldId);
    const corruptInstitution = fixture.db.table('townInstitutions').find(
      (row) => row.worldId === corruptWorldId,
    )!;
    corruptInstitution.stockJson = '{malformed';
    const nextDay = Date.parse('2026-07-20T00:01:00+08:00');

    expect(await dispatchDailyEconomyPage(fixture.ctx, { cursor: null, now: nextDay }))
      .toEqual({ scheduledWorlds: 2, done: true });
    await expect(advanceDailyEconomyForWorldNow(fixture.ctx, {
      worldId: corruptWorldId,
      now: nextDay,
    })).rejects.toThrow(/stockJson/iu);
    expect(await advanceDailyEconomyForWorldNow(fixture.ctx, {
      worldId: healthyWorldId,
      now: nextDay,
    })).toEqual({ status: 'advanced', advancedInstitutions: 9 });
    expect(await advanceDailyEconomyForWorldNow(fixture.ctx, {
      worldId: pausedWorldId,
      now: nextDay,
    })).toEqual({ status: 'world-not-running', advancedInstitutions: 0 });
    expect(fixture.db.table('economyLedger').filter(
      (row) => row.worldId === healthyWorldId && row.kind === 'restock',
    )).toHaveLength(9);
    expect(fixture.db.table('dailyEconomyDays').filter(
      (row) => row.worldId === healthyWorldId && row.dayKey === '2026-07-20',
    )).toHaveLength(1);
  });

  test('charges only available institution cash and records the actual operating cost', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    seedRuntimeResidents(fixture.db);
    await initializeTownEconomy(fixture.ctx, worldId, now);
    const teaHouse = fixture.db.table('townInstitutions').find(
      (row) => row.institutionId === 'tea-house',
    )!;
    teaHouse.cash = 1;

    await advanceDailyEconomy(fixture.ctx, Date.parse('2026-07-20T00:01:00+08:00'));

    expect(teaHouse).toEqual(expect.objectContaining({ cash: 0, todayExpense: 1 }));
    expect(fixture.db.table('economyLedger')).toContainEqual(expect.objectContaining({
      kind: 'restock',
      institutionId: 'tea-house',
      amount: 1,
      dayKey: '2026-07-20',
    }));
  });

  test('restores configured goods to their caps without inventing service output', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    seedRuntimeResidents(fixture.db);
    await initializeTownEconomy(fixture.ctx, worldId, now);
    const workshop = fixture.db.table('townInstitutions').find(
      (row) => row.institutionId === 'workshop',
    )!;
    const academy = fixture.db.table('townInstitutions').find(
      (row) => row.institutionId === 'academy',
    )!;
    workshop.stockJson = JSON.stringify({ 'craft-service': 2 });
    workshop.serviceCountersJson = JSON.stringify({ repair: 7, 'lantern-making': 8 });
    academy.serviceCountersJson = JSON.stringify({ teaching: 11 });

    await advanceDailyEconomy(fixture.ctx, Date.parse('2026-07-20T00:01:00+08:00'));

    expect(workshop.stockJson).toBe(JSON.stringify({ 'craft-service': 99 }));
    expect(workshop.serviceCountersJson).toBe(
      JSON.stringify({ repair: 7, 'lantern-making': 8 }),
    );
    expect(academy.serviceCountersJson).toBe(JSON.stringify({ teaching: 11 }));
    expect(fixture.db.table('economyLedger').filter(
      (row) => row.kind === 'restock' && row.institutionId === 'academy',
    )).toHaveLength(1);
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
      compensationKind: 'owner-draw' as const,
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
    expect(db.table('economyLedger')[0]).toEqual(expect.objectContaining({
      compensationKind: 'owner-draw',
    }));
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
    await expect(appendEconomyLedger(ctx, { ...base, quantity: 0 } as never)).rejects.toThrow(/quantity/u);
    await expect(appendEconomyLedger(ctx, {
      ...base,
      quantity: MAX_STOCK + 1,
    } as never)).rejects.toThrow(/quantity/u);
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
      compensationKind: 'owner-draw',
      item: 'tea',
      quantity: 3,
      sourceKey: 'activity:o:unpaid',
      text: '完成备货，机构本次未能支付。',
      createdAt: now,
    })).toBe(true);
    expect(db.table('economyLedger')[0]).toEqual(expect.objectContaining({
      amount: 0,
      expectedAmount: 16,
      compensationKind: 'owner-draw' as const,
    }));
  });

  test('treats an exact pre-expectedAmount legacy work replay as idempotent', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);
    const entry = {
      worldId,
      idempotencyKey: 'work:worlds:test:p:2:o:legacy',
      dayKey: '2026-07-19',
      residentId: 'p:2',
      institutionId: 'tea-house',
      kind: 'work' as const,
      amount: 16,
      expectedAmount: 16,
      compensationKind: 'owner-draw' as const,
      item: 'tea',
      quantity: 3,
      sourceKey: 'activity:o:legacy',
      text: '完成一次茶叶备货。',
      createdAt: now,
    };
    const {
      expectedAmount: _legacyMissingExpected,
      compensationKind: _legacyMissingCompensation,
      ...legacy
    } = entry;
    db.seed('economyLedger', legacy);
    expect(await appendEconomyLedger(ctx, entry)).toBe(false);
    expect(db.table('economyLedger')).toHaveLength(1);

    const conflicting = makeContext();
    seedRuntimeResidents(conflicting.db);
    await initializeTownEconomy(conflicting.ctx, worldId, now);
    conflicting.db.seed('economyLedger', {
      ...legacy,
      expectedAmount: 15,
      compensationKind: 'wage',
    });
    await expect(appendEconomyLedger(conflicting.ctx, entry)).rejects.toThrow(/collision/u);
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
      compensationKind: 'owner-draw' as const,
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
    } as never)).rejects.toThrow(/expectedAmount/u);
    await expect(appendEconomyLedger(ctx, {
      ...work,
      idempotencyKey: 'work:missing-compensation-kind',
      compensationKind: undefined,
    } as never)).rejects.toThrow(/compensationKind/u);
    await expect(appendEconomyLedger(ctx, {
      ...work,
      idempotencyKey: 'work:wrong-compensation-kind',
      compensationKind: 'wage' as const,
    })).rejects.toThrow(/compensationKind/u);
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
      idempotencyKey: 'reward:shanghai-year-overflow',
      dayKey: '9999-12-31',
      createdAt: Date.parse('9999-12-31T16:00:00.000Z'),
    })).rejects.toThrow(/createdAt/u);
    await expect(appendEconomyLedger(ctx, {
      ...reward,
      idempotencyKey: 'reward:text-overflow',
      text: '事'.repeat(501),
    })).rejects.toThrow(/text/u);
    expect(db.table('economyLedger')).toHaveLength(0);
  });

  test('fails closed for an unknown ledger kind at the exhaustive runtime boundary', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);
    await expect(appendEconomyLedger(ctx, {
      worldId,
      idempotencyKey: 'unknown:kind',
      dayKey: '2026-07-19',
      kind: 'unknown',
      amount: 0,
      sourceKey: 'unknown:kind',
      text: '非法类型。',
      createdAt: now,
    } as never)).rejects.toThrow(/unknown ledger kind/iu);
  });

  test('settles completed work once only at the exact active location', async () => {
    const { db, ctx } = settlementContext();
    const args = workSettlementArgs();
    expect(await settleActivity(ctx, args)).toMatchObject({ status: 'settled', amount: 16 });
    expect(await settleActivity(ctx, args)).toEqual({ status: 'already-settled' });
    expect(db.table('residentEconomy')[0]).toEqual(expect.objectContaining({
      balance: 166,
      hunger: 99,
      energy: 99,
      todayIncome: 16,
    }));
    const teaHouse = db.table('townInstitutions').find(
      (row) => row.institutionId === 'tea-house',
    );
    expect(teaHouse).toEqual(expect.objectContaining({
      cash: 104,
      stockJson: JSON.stringify({ tea: 15 }),
    }));
    expect(db.table('economyLedger')).toHaveLength(1);
    expect(db.table('lifeEvents')).toHaveLength(2);
  });

  test('advances the day before work settlement and leaves a later cron idempotent', async () => {
    const fixture = settlementContext({ dailyAdvanced: false });
    const args = workSettlementArgs();

    expect(await settleActivity(fixture.ctx, args)).toMatchObject({ status: 'settled', amount: 16 });
    const teaHouse = fixture.db.table('townInstitutions').find(
      (row) => row.institutionId === 'tea-house',
    );
    expect(teaHouse).toEqual(expect.objectContaining({
      cash: 102,
      todayExpense: 18,
      dayKey: '2026-07-19',
    }));
    expect(fixture.db.table('economyLedger').filter((row) => row.kind === 'restock'))
      .toHaveLength(9);
    const beforeCron = fixture.db.snapshot();
    expect(await advanceDailyEconomy(fixture.ctx, now)).toEqual({
      advancedWorlds: 0,
      advancedInstitutions: 0,
    });
    expect(fixture.db.snapshot()).toEqual(beforeCron);
  });

  test('advances the day before purchase settlement and preserves today flow', async () => {
    const fixture = settlementContext({ position: { x: 8, y: 24 }, dailyAdvanced: false });
    const args = purchaseSettlementArgs();
    seedActivityStart(fixture.db, args.operationId, args.activityText);

    expect(await settleActivity(fixture.ctx, args)).toMatchObject({ status: 'settled', amount: 6 });
    const restaurant = fixture.db.table('townInstitutions').find(
      (row) => row.institutionId === 'restaurant',
    );
    expect(restaurant).toEqual(expect.objectContaining({
      cash: 124,
      todayIncome: 6,
      todayExpense: 2,
      visitorCount: 1,
    }));
    expect(fixture.db.table('residentEconomy')[0]).toEqual(expect.objectContaining({
      todayExpense: 6,
    }));
    expect(fixture.db.table('economyLedger').filter((row) => row.kind === 'restock'))
      .toHaveLength(9);
  });

  test('returns the immutable completed outcome after the resident changes activity', async () => {
    const fixture = settlementContext();
    const args = workSettlementArgs();
    expect(await settleActivity(fixture.ctx, args)).toMatchObject({ status: 'settled' });
    const player = (fixture.db.table('worlds')[0].players as Array<Record<string, unknown>>)[0];
    player.activity = {
      description: '在听雨茶庄：开始另一项日常事务',
      emoji: '🧹',
      until: now + 60_000,
    };
    expect(await settleActivity(fixture.ctx, args)).toEqual({ status: 'already-settled' });
    expect(fixture.db.table('economyLedger')).toHaveLength(1);
  });

  test('rejects an operation history containing both completed and failed outcomes', async () => {
    const fixture = settlementContext();
    const args = workSettlementArgs();
    expect(await settleActivity(fixture.ctx, args)).toMatchObject({ status: 'settled' });
    fixture.db.seed('lifeEvents', {
      worldId,
      residentId: args.residentId,
      kind: args.category,
      text: `${args.activityText}；活动未完成：居民已经改做其他事情。`,
      createdAt: now + 1,
      sourceKey: `activity:${args.operationId}:failed`,
      operationId: args.operationId,
      phase: 'failed',
      category: args.category,
      landmarkId: args.landmarkId,
      economicActionJson: JSON.stringify(args.economicAction),
      activityUntil: args.activityUntil,
      failureReason: 'activity-replaced',
    });

    await expect(settleActivity(fixture.ctx, args)).rejects.toThrow(/outcome collision/u);
  });

  test('never settles from prose, an early timer or a resident outside the destination', async () => {
    const fixtures = [
      { fixture: settlementContext(), args: workSettlementArgs({ activityText: '另一段描述' }) },
      { fixture: settlementContext(), args: { ...workSettlementArgs(), operationId: 'o:other' } },
      { fixture: settlementContext(), args: workSettlementArgs({ now: now - 1 }) },
      {
        fixture: settlementContext({ position: { x: 30, y: 20 } }),
        args: workSettlementArgs(),
      },
    ];
    for (const { fixture, args } of fixtures) {
      expect(await settleActivity(fixture.ctx, args)).not.toMatchObject({
        status: 'settled',
      });
      expect(fixture.db.table('economyLedger')).toHaveLength(0);
      expect(fixture.db.table('lifeEvents').filter((event) => event.phase === 'failed')).toHaveLength(0);
      expect(fixture.db.table('residentEconomy')[0]).toEqual(expect.objectContaining({
        balance: 150,
      }));
    }
  });

  test('records structured terminal failures but never mutates financial state', async () => {
    const replaced = settlementContext();
    const replacedPlayer = (
      replaced.db.table('worlds')[0].players as Array<Record<string, unknown>>
    )[0];
    (replacedPlayer.activity as Record<string, unknown>).description = '在听雨茶庄：改做别的事情';
    expect(await settleActivity(replaced.ctx, workSettlementArgs())).toEqual({
      status: 'rejected',
      reason: 'activity-replaced',
    });
    expect(replaced.db.table('lifeEvents')).toContainEqual(expect.objectContaining({
      phase: 'failed',
      failureReason: 'activity-replaced',
      kind: 'work',
    }));
    expect(replaced.db.table('economyLedger')).toHaveLength(0);

    const invalidWork = settlementContext();
    await initializeTownEconomy(invalidWork.ctx, worldId, now);
    const teaHouse = invalidWork.db.table('townInstitutions').find(
      (row) => row.institutionId === 'tea-house',
    )!;
    teaHouse.stockJson = JSON.stringify({ tea: MAX_STOCK });
    expect(await settleActivity(invalidWork.ctx, workSettlementArgs())).toEqual({
      status: 'rejected',
      reason: 'invalid-work-state',
    });
    expect(invalidWork.db.table('lifeEvents')).toContainEqual(expect.objectContaining({
      phase: 'failed',
      failureReason: 'invalid-work-state',
    }));
    expect(teaHouse).toEqual(expect.objectContaining({ cash: 120 }));

    const exhausted = settlementContext({ position: { x: 30, y: 20 } });
    expect(await settleActivity(exhausted.ctx, {
      ...workSettlementArgs(),
      terminalFailureReason: 'destination-not-reached',
    })).toEqual({ status: 'rejected', reason: 'destination-not-reached' });
    expect(exhausted.db.table('lifeEvents')).toContainEqual(expect.objectContaining({
      phase: 'failed',
      failureReason: 'destination-not-reached',
    }));
  });

  test('transfers purchase money and stock atomically and rejects insufficient funds', async () => {
    const success = settlementContext({ position: { x: 8, y: 24 } });
    const args = purchaseSettlementArgs();
    seedActivityStart(success.db, args.operationId, args.activityText);
    expect(await settleActivity(success.ctx, args)).toMatchObject({ status: 'settled', amount: 6 });
    expect(success.db.table('residentEconomy')[0]).toEqual(expect.objectContaining({
      balance: 144,
      hunger: 100,
      todayExpense: 6,
    }));
    const restaurant = success.db.table('townInstitutions').find(
      (row) => row.institutionId === 'restaurant',
    );
    expect(restaurant).toEqual(expect.objectContaining({
      cash: 126,
      stockJson: JSON.stringify({ meal: 11 }),
      visitorCount: 1,
    }));

    const rejected = settlementContext({ startingBalance: 2, position: { x: 8, y: 24 } });
    seedActivityStart(rejected.db, args.operationId, args.activityText);
    expect(await settleActivity(rejected.ctx, purchaseSettlementArgs())).toEqual({
      status: 'rejected',
      reason: 'insufficient-funds-or-stock',
    });
    expect(await settleActivity(rejected.ctx, purchaseSettlementArgs())).toEqual({
      status: 'already-failed',
      reason: 'insufficient-funds-or-stock',
    });
    expect(rejected.db.table('economyLedger')).toHaveLength(0);
    expect(rejected.db.table('lifeEvents')).toHaveLength(3);
    expect(rejected.db.table('lifeEvents')).toContainEqual(expect.objectContaining({
      kind: 'food',
      phase: 'failed',
      sourceKey: 'activity:o:purchase:1:failed',
      failureReason: 'insufficient-funds-or-stock',
    }));
    expect(rejected.db.table('residentEconomy')[0]).toEqual(expect.objectContaining({
      balance: 2,
    }));
    const rejectedRestaurant = rejected.db.table('townInstitutions').find(
      (row) => row.institutionId === 'restaurant',
    );
    expect(rejectedRestaurant).toEqual(expect.objectContaining({
      cash: 120,
      stockJson: JSON.stringify({ meal: 12 }),
    }));
  });

  test('applies one common need decay before purchase benefit with boundary clamps', async () => {
    const fixture = settlementContext({ position: { x: 8, y: 24 } });
    fixture.db.seed('residentEconomy', validResidentRow({
      residentId: 'p:2',
      profileId: 'tang-guo',
      balance: 150,
      initialBalance: 150,
      hunger: 10,
      energy: 0,
      initializationSourceKey: 'economy-definition:resident:tang-guo:v1',
    }));
    const args = purchaseSettlementArgs();
    seedActivityStart(fixture.db, args.operationId, args.activityText);

    expect(await settleActivity(fixture.ctx, args)).toMatchObject({ status: 'settled' });
    expect(fixture.db.table('residentEconomy')[0]).toEqual(expect.objectContaining({
      hunger: 34,
      energy: 0,
    }));
  });

  test('fails before mutation when derived daily counters reach their exact bounds', async () => {
    const fixture = settlementContext();
    fixture.db.seed('residentEconomy', validResidentRow({
      residentId: 'p:2',
      profileId: 'tang-guo',
      balance: 150,
      initialBalance: 150,
      todayIncome: MAX_MONEY,
      initializationSourceKey: 'economy-definition:resident:tang-guo:v1',
    }));
    expect(await settleActivity(fixture.ctx, workSettlementArgs())).toEqual({
      status: 'rejected',
      reason: 'counter-boundary-exceeded',
    });
    expect(fixture.db.table('residentEconomy')[0]).toEqual(expect.objectContaining({
      balance: 150,
      todayIncome: MAX_MONEY,
    }));
    const teaHouse = fixture.db.table('townInstitutions').find(
      (row) => row.institutionId === 'tea-house',
    );
    expect(teaHouse).toEqual(expect.objectContaining({ cash: 120 }));
    expect(fixture.db.table('economyLedger')).toHaveLength(0);
    expect(fixture.db.table('lifeEvents')).toContainEqual(expect.objectContaining({
      failureReason: 'counter-boundary-exceeded',
    }));
  });

  test('rejects malformed persisted failed outcomes instead of accepting a loose prefix', async () => {
    const fixture = settlementContext({ startingBalance: 2, position: { x: 8, y: 24 } });
    const args = purchaseSettlementArgs();
    seedActivityStart(fixture.db, args.operationId, args.activityText);
    await settleActivity(fixture.ctx, args);
    const failed = fixture.db.table('lifeEvents').find((event) => event.phase === 'failed')!;
    failed.text = `${args.activityText}；随便写的失败正文`;
    await expect(settleActivity(fixture.ctx, args)).rejects.toThrow(/outcome collision/u);

    failed.text = `${args.activityText}；消费未完成：余额不足或库存不足。`;
    delete failed.failureReason;
    await expect(settleActivity(fixture.ctx, args)).rejects.toThrow(/outcome collision/u);
  });

  test('settles rest once without creating a financial fact', async () => {
    const fixture = settlementContext({ position: { x: 15, y: 20 } });
    const account = fixture.db.seed('residentEconomy', validResidentRow({
      residentId: 'p:2',
      profileId: 'tang-guo',
      balance: 150,
      initialBalance: 150,
      energy: 40,
      initializationSourceKey: 'economy-definition:resident:tang-guo:v1',
    }));
    const args = {
      ...workSettlementArgs(),
      operationId: 'o:rest:1',
      landmarkId: 'morning-market' as const,
      category: 'care' as const,
      economicAction: { kind: 'rest' as const },
    };
    const player = (fixture.db.table('worlds')[0].players as Array<Record<string, unknown>>)[0];
    const playerActivity = player.activity as { description: string };
    playerActivity.description = args.activityText;
    seedActivityStart(fixture.db, args.operationId, args.activityText);
    expect(await settleActivity(fixture.ctx, args)).toMatchObject({ status: 'settled' });
    expect(await settleActivity(fixture.ctx, args)).toEqual({ status: 'already-settled' });
    expect(account).toEqual(expect.objectContaining({ hunger: 99, energy: 64 }));
    expect(fixture.db.table('economyLedger')).toHaveLength(0);
  });

  test('clamps common work need decay at zero', async () => {
    const fixture = settlementContext();
    fixture.db.seed('residentEconomy', validResidentRow({
      residentId: 'p:2',
      profileId: 'tang-guo',
      balance: 150,
      initialBalance: 150,
      hunger: 0,
      energy: 0,
      initializationSourceKey: 'economy-definition:resident:tang-guo:v1',
    }));

    expect(await settleActivity(fixture.ctx, workSettlementArgs()))
      .toMatchObject({ status: 'settled' });
    expect(fixture.db.table('residentEconomy')[0]).toEqual(expect.objectContaining({
      hunger: 0,
      energy: 0,
    }));
  });

  test('records nonfinancial activity only after an engine activation acknowledgement', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    addRuntimeResident(fixture.db, '唐果', 'p:2');
    const queued = await enqueueResidentActivityInput(fixture.ctx, {
      worldId,
      residentId: 'p:2',
      agentId: 'a:2',
      operationId: 'o:social:delayed',
      activityText: '在听雨茶庄：和邻居聊聊今日见闻',
      activityDuration: 60_000,
      landmarkId: 'tea-house',
      category: 'social',
      startedAt: now,
      destination: { x: 5, y: 20 },
      emoji: '🫖',
    });
    expect(fixture.db.table('lifeEvents')).toHaveLength(0);
    const registration = fixture.db.table('activityRegistrations')[0];
    await applyCompletedActivityRegistrationAcks(fixture.ctx, worldId, [{
      inputId: queued.inputId as Id<'inputs'>,
      returnValue: {
        kind: 'ok',
        value: { activityRegistration: {
          registrationId: registration._id,
          operationId: registration.operationId,
          agentId: registration.agentId,
          residentId: registration.residentId,
          status: 'activated',
          activatedAt: now + 5_000,
          activityUntil: now + 65_000,
        } },
      },
    }]);
    expect(fixture.db.table('lifeEvents')).toHaveLength(0);
    const outbox = fixture.db.table('activityRegistrationAcks')[0];
    expect(await processActivityRegistrationAckOutbox(fixture.ctx, {
      outboxId: outbox._id as Id<'activityRegistrationAcks'>,
    })).toEqual({ status: 'activated' });
    expect(fixture.db.table('lifeEvents')).toContainEqual(expect.objectContaining({
      sourceKey: 'activity:o:social:delayed:start',
      phase: 'start',
      kind: 'social',
    }));
    expect(await pendingResidentActivitySettlementForResident(fixture.ctx, {
      worldId,
      residentId: 'p:2',
      activityText: '在听雨茶庄：和邻居聊聊今日见闻',
      activityUntil: now + 65_000,
    })).toBeNull();
  });

  test('does not send an acknowledged leisure start into economic settlement recovery', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    addRuntimeResident(fixture.db, '唐果', 'p:2');
    const activityText = '在旧水码头：听一会儿河上桨声';
    const queued = await enqueueResidentActivityInput(fixture.ctx, {
      worldId,
      residentId: 'p:2',
      agentId: 'a:2',
      operationId: 'o:leisure:activated',
      activityText,
      activityDuration: 60_000,
      landmarkId: 'old-dock',
      category: 'leisure',
      startedAt: now,
      destination: { x: 5, y: 20 },
    });
    const registration = fixture.db.table('activityRegistrations')[0];
    await applyCompletedActivityRegistrationAcks(fixture.ctx, worldId, [{
      inputId: queued.inputId as Id<'inputs'>,
      returnValue: {
        kind: 'ok',
        value: { activityRegistration: {
          registrationId: registration._id,
          operationId: registration.operationId,
          agentId: registration.agentId,
          residentId: registration.residentId,
          status: 'activated',
          activatedAt: now,
          activityUntil: now + 60_000,
        } },
      },
    }]);
    const outbox = fixture.db.table('activityRegistrationAcks')[0];
    await processActivityRegistrationAckOutbox(fixture.ctx, {
      outboxId: outbox._id as Id<'activityRegistrationAcks'>,
    });

    expect(await pendingResidentActivitySettlementForResident(fixture.ctx, {
      worldId,
      residentId: 'p:2',
      activityText,
      activityUntil: now + 60_000,
    })).toBeNull();
    expect(fixture.scheduler.calls.filter(
      (call) => call.args.operationId === 'o:leisure:activated',
    )).toHaveLength(0);
  });

  test('never records a replaced nonfinancial intent as fact', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    addRuntimeResident(fixture.db, '唐果', 'p:2');
    const queued = await enqueueResidentActivityInput(fixture.ctx, {
      worldId,
      residentId: 'p:2',
      agentId: 'a:2',
      operationId: 'o:leisure:replaced',
      activityText: '在旧水码头：听一会儿河上桨声',
      activityDuration: 60_000,
      landmarkId: 'old-dock',
      category: 'leisure',
      startedAt: now,
      destination: { x: 5, y: 20 },
    });
    const registration = fixture.db.table('activityRegistrations')[0];
    await applyCompletedActivityRegistrationAcks(fixture.ctx, worldId, [{
      inputId: queued.inputId as Id<'inputs'>,
      returnValue: {
        kind: 'ok',
        value: { activityRegistration: {
          registrationId: registration._id,
          operationId: registration.operationId,
          agentId: registration.agentId,
          residentId: registration.residentId,
          status: 'rejected',
          acknowledgedAt: now + 5_000,
          reason: 'operation-replaced',
        } },
      },
    }]);
    const outbox = fixture.db.table('activityRegistrationAcks')[0];
    expect(await processActivityRegistrationAckOutbox(fixture.ctx, {
      outboxId: outbox._id as Id<'activityRegistrationAcks'>,
    })).toEqual({ status: 'abandoned' });
    expect(fixture.db.table('lifeEvents')).toHaveLength(0);
  });

  test('fails closed when a settled operation id is reused for different facts', async () => {
    const fixture = settlementContext();
    const original = workSettlementArgs();
    await settleActivity(fixture.ctx, original);
    const player = (fixture.db.table('worlds')[0].players as Array<Record<string, unknown>>)[0];
    (player.activity as Record<string, unknown>).description = '在听雨茶庄：另一项工作';
    await expect(settleActivity(fixture.ctx, {
      ...original,
      activityText: '在听雨茶庄：另一项工作',
      economicAction: {
        kind: 'work',
        institutionId: 'tea-house',
        output: { kind: 'stock', item: 'tea', quantity: 2 },
      },
    })).rejects.toThrow(/activity operation collision/u);
    expect(fixture.db.table('economyLedger')).toHaveLength(1);
  });

  test('fails closed when a completed rest operation is reused with changed facts', async () => {
    const fixture = settlementContext({ position: { x: 15, y: 20 } });
    const args = {
      ...workSettlementArgs(),
      operationId: 'o:rest:collision',
      landmarkId: 'morning-market' as const,
      category: 'care' as const,
      economicAction: { kind: 'rest' as const },
    };
    seedActivityStart(fixture.db, args.operationId, args.activityText);
    expect(await settleActivity(fixture.ctx, args)).toMatchObject({ status: 'settled' });
    const player = (fixture.db.table('worlds')[0].players as Array<Record<string, unknown>>)[0];
    (player.activity as Record<string, unknown>).description = '在晨雾集市：另一段休息';
    await expect(settleActivity(fixture.ctx, {
      ...args,
      activityText: '在晨雾集市：另一段休息',
    })).rejects.toThrow(/activity operation collision/u);
  });

  test('keeps structured activity phases in the original daily taxonomy', async () => {
    const fixture = settlementContext();
    await settleActivity(fixture.ctx, workSettlementArgs());
    expect(fixture.db.table('lifeEvents')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'work', phase: 'start', category: 'work' }),
      expect.objectContaining({ kind: 'work', phase: 'complete', category: 'work' }),
    ]));
  });

  test('recovers initialization after pause and after startup reconciliation exhaustion', async () => {
    const paused = settlementContext({ status: 'stoppedByDeveloper' });
    const args = workSettlementArgs();
    expect(await settleActivity(paused.ctx, args)).toEqual({ status: 'world-not-running' });
    expect(paused.db.table('residentEconomy')).toHaveLength(0);
    paused.db.table('worldStatus')[0].status = 'running';
    expect(await settleActivity(paused.ctx, args)).toMatchObject({ status: 'settled' });

    const longDistance = settlementContext({
      status: 'stoppedByDeveloper',
      position: { x: 30, y: 20 },
    });
    const movingPlayer = (
      longDistance.db.table('worlds')[0].players as Array<Record<string, unknown>>
    )[0];
    movingPlayer.pathfinding = {
      destination: { x: 5, y: 20 },
      started: now,
      state: { kind: 'needsPath' },
    };
    expect(await settleActivity(longDistance.ctx, args)).toEqual({ status: 'world-not-running' });
    longDistance.db.table('worldStatus')[0].status = 'running';
    expect(await settleActivity(longDistance.ctx, args)).toEqual({
      status: 'destination-not-reached',
      destinationProgressing: true,
    });
    movingPlayer.position = { x: 5, y: 20 };
    expect(await settleActivity(longDistance.ctx, args)).toMatchObject({ status: 'settled' });

    const delayed = makeContext();
    seedWorldStatus(delayed.db, 'running');
    delayed.db.seed('worlds', {
      _id: worldId, nextId: 0, players: [], agents: [], conversations: [],
    });
    await reconcileTownEconomyAfterAgentCreation(delayed.ctx, {
      worldId,
      attempt: MAX_ECONOMY_RECONCILIATION_ATTEMPTS,
      now,
    });
    addSettlementResident(delayed.db, { x: 5, y: 20 }, workSettlementArgs().activityText);
    expect(await settleActivity(delayed.ctx, workSettlementArgs())).toMatchObject({
      status: 'settled',
    });
    expect(delayed.db.table('residentEconomy')).toHaveLength(1);
  });

  test('rejects enqueue atomically when the world pauses during deferred local completion', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    let signalCompletionStarted!: () => void;
    let releaseCompletion!: () => void;
    const completionStarted = new Promise<void>((resolve) => {
      signalCompletionStarted = resolve;
    });
    const completionReleased = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    const choice = {
      needs: [],
      criticalNeeds: [],
      state: { hunger: 100, energy: 100, balance: 100 },
      activities: [{
        description: '整理茶叶',
        emoji: '🍵',
        duration: 60_000,
        category: 'work' as const,
        landmarkId: 'tea-house' as const,
        economicAction: {
          kind: 'work' as const,
          institutionId: 'tea-house' as const,
          output: { kind: 'stock' as const, item: 'tea' as const, quantity: 1 },
        },
      }],
    };
    const choosing = chooseResidentActivityWithLocalModel('唐果', choice, {
      isWorldRunning: async () => fixture.db.table('worldStatus')[0]?.status === 'running',
      complete: async () => {
        signalCompletionStarted();
        await completionReleased;
        return { content: '0', retries: 0, ms: 1 };
      },
    });
    await completionStarted;
    fixture.db.table('worldStatus')[0].status = 'inactive';
    releaseCompletion();
    const selected = await choosing;
    expect(selected).toBe(choice.activities[0]);

    expect(await enqueueResidentActivityInput(fixture.ctx, {
      worldId,
      residentId: 'p:2',
      agentId: 'a:2',
      operationId: 'o:paused-during-completion',
      activityText: '在听雨茶庄：整理茶叶',
      activityDuration: selected!.duration + 60_000,
      landmarkId: selected!.landmarkId,
      category: selected!.category,
      economicAction: selected!.economicAction,
      startedAt: now,
      destination: { x: 5, y: 20 },
      emoji: selected!.emoji,
    })).toEqual({ status: 'world-not-running' });
    expect(fixture.db.table('activityRegistrations')).toHaveLength(0);
    expect(fixture.db.table('inputs')).toHaveLength(0);
    expect(fixture.db.table('lifeEvents')).toHaveLength(0);
  });

  test('validates structured activity semantics and registers start plus schedule exactly once', async () => {
    const base = workSettlementArgs();
    expect(() => validateActivityRegistration(base, now - 1)).not.toThrow();
    expect(() => validateActivityRegistration({ ...base, activityUntil: now - 2 }, now - 1))
      .toThrow(/activityUntil/u);
    expect(() => validateActivityRegistration({ ...base, operationId: 'INVALID OP' }, now - 1))
      .toThrow(/operationId/u);
    expect(() => validateActivityRegistration({ ...base, activityText: '事'.repeat(501) }, now - 1))
      .toThrow(/activityText/u);
    expect(() => validateActivityRegistration({
      ...base,
      economicAction: {
        ...base.economicAction,
        output: { ...base.economicAction.output, quantity: MAX_STOCK + 1 },
      },
    }, now - 1)).toThrow(/work quantity/u);
    expect(() => validateActivityRegistration({ ...base, landmarkId: 'restaurant' }, now - 1))
      .toThrow(/landmark/u);
    expect(() => validateActivityRegistration({
      ...base,
      landmarkId: 'missing-place' as never,
    }, now - 1)).toThrow(/Unknown town landmark/u);

    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    addRuntimeResident(fixture.db, '唐果', 'p:2');
    const registration = {
      worldId: base.worldId,
      residentId: base.residentId,
      operationId: base.operationId,
      activityText: base.activityText,
      activityDuration: 60_000,
      landmarkId: base.landmarkId,
      category: base.category,
      economicAction: base.economicAction,
      startedAt: now - 1,
      agentId: 'a:2',
      destination: { x: 5, y: 20 },
      emoji: '🍵',
    };
    const queued = await enqueueResidentActivityInput(fixture.ctx, registration);
    expect(queued.status).toBe('queued');
    expect(typeof queued.registrationId).toBe('string');
    expect(typeof queued.inputId).toBe('string');
    const replay = await enqueueResidentActivityInput(fixture.ctx, registration);
    expect(replay).toEqual({
      status: 'already-queued',
      registrationId: queued.registrationId,
      inputId: queued.inputId,
    });
    expect(fixture.db.table('activityRegistrations')).toHaveLength(1);
    expect(fixture.db.table('inputs')).toHaveLength(1);
    expect(fixture.db.table('lifeEvents')).toHaveLength(0);
    expect(fixture.scheduler.calls).toHaveLength(0);
    const storedRegistration = fixture.db.table('activityRegistrations')[0];
    const storedInput = fixture.db.table('inputs')[0];
    expect(storedRegistration).toEqual(expect.objectContaining({
      agentId: registration.agentId,
      inputId: storedInput._id as Id<'inputs'>,
      deliveryState: 'queued',
    }));
    expect(storedInput.name).toBe('finishDoSomething');
    expect((storedInput.args as Record<string, unknown>).activityRegistrationId)
      .toBe(storedRegistration._id);

    // A paused engine keeps the atomically queued input and intent without polling or expiry.
    fixture.db.table('worldStatus')[0].status = 'stoppedByDeveloper';
    const player = (fixture.db.table('worlds')[0].players as Array<Record<string, unknown>>)[0];
    player.position = { x: 5, y: 20 };
    expect(fixture.db.table('activityRegistrations')[0].state).toBe('intent');

    // The engine acknowledgement is the trusted activation clock after a long pause/delay.
    const activatedAt = now + 86_500_000;
    const activityUntil = activatedAt + registration.activityDuration;
    fixture.db.table('worldStatus')[0].status = 'running';
    player.activity = {
      description: registration.activityText,
      emoji: '🍵',
      until: activityUntil,
    };
    const forged = await applyCompletedActivityRegistrationAcks(fixture.ctx, worldId, [{
      inputId: 'inputs:fully-unlinked-forgery' as Id<'inputs'>,
      returnValue: { kind: 'ok', value: { activityRegistration: {} } },
    }]);
    expect(forged).toEqual([]);
    expect(storedRegistration.state).toBe('intent');
    expect(fixture.db.table('activityRegistrationAcks')).toHaveLength(0);
    expect(fixture.db.table('lifeEvents')).toHaveLength(0);

    const completedInput = {
      inputId: storedInput._id as Id<'inputs'>,
      returnValue: {
        kind: 'ok',
        value: {
          activityRegistration: {
            operationId: registration.operationId,
            registrationId: storedRegistration._id,
            agentId: registration.agentId,
            residentId: registration.residentId,
            status: 'activated',
            activatedAt,
            activityUntil,
          },
        },
      },
    };
    const persisted = await applyCompletedActivityRegistrationAcks(
      fixture.ctx, worldId, [completedInput],
    );
    expect(persisted[0]?.status).toBe('persisted');
    expect(typeof (persisted[0] as { outboxId?: unknown }).outboxId).toBe('string');
    expect(fixture.db.table('lifeEvents')).toHaveLength(0);
    expect(fixture.db.table('activityRegistrations')[0].state).toBe('intent');
    expect(fixture.db.table('activityRegistrations')[0]).toEqual(expect.objectContaining({
      deliveryState: 'processing',
    }));
    expect(fixture.db.table('activityRegistrationAcks')).toHaveLength(1);
    expect(fixture.db.table('activityRegistrationAcks')[0]).toEqual(expect.objectContaining({
      worldId,
      inputId: storedInput._id,
      registrationId: storedRegistration._id,
      ackKind: 'activated',
      status: 'pending',
      attempts: 0,
    }));
    expect(fixture.scheduler.calls.at(-1)).toEqual(expect.objectContaining({
      delay: 0,
    }));
    const schedulerCount = fixture.scheduler.calls.length;
    const replayedAck = await applyCompletedActivityRegistrationAcks(
      fixture.ctx, worldId, [completedInput],
    );
    expect(replayedAck[0]?.status).toBe('already-persisted');
    expect((replayedAck[0] as { outboxId?: unknown }).outboxId)
      .toBe(fixture.db.table('activityRegistrationAcks')[0]._id);
    expect(fixture.scheduler.calls).toHaveLength(schedulerCount);
    const outbox = fixture.db.table('activityRegistrationAcks')[0];
    fixture.scheduler.failNext = true;
    expect(await dispatchActivityRegistrationAckWithRecovery({
      process: () => runMemoryMutation(fixture, () => processActivityRegistrationAckOutbox(
        fixture.ctx,
        { outboxId: outbox._id as Id<'activityRegistrationAcks'> },
      )),
      recordFailure: () => recordActivityRegistrationAckFailure(fixture.ctx, {
        outboxId: outbox._id as Id<'activityRegistrationAcks'>,
        errorCode: 'scheduler-unavailable secret detail',
      }),
    })).toEqual({ status: 'retrying', attempts: 1, delay: 2_000 });
    expect(fixture.db.table('lifeEvents')).toHaveLength(0);
    expect(fixture.db.table('activityRegistrations')[0]).toEqual(expect.objectContaining({
      state: 'intent',
      deliveryState: 'processing',
    }));
    const recoveredOutbox = fixture.db.table('activityRegistrationAcks')[0];
    expect(recoveredOutbox).toEqual(expect.objectContaining({
      status: 'retrying',
      attempts: 1,
      errorCode: 'ack-processing-failed',
    }));
    expect(fixture.scheduler.calls.at(-1)).toEqual(expect.objectContaining({ delay: 2_000 }));
    expect(await processActivityRegistrationAckOutbox(fixture.ctx, {
      outboxId: outbox._id as Id<'activityRegistrationAcks'>,
    })).toEqual({ status: 'activated' });
    expect(fixture.db.table('lifeEvents')).toContainEqual(expect.objectContaining({
      sourceKey: 'activity:o:work:1:start',
      phase: 'start',
    }));
    expect(fixture.db.table('activityRegistrations')[0]).toEqual(expect.objectContaining({
      state: 'activated',
      activatedAt,
      activityUntil,
      deliveryState: 'processed',
    }));
    expect(recoveredOutbox).toEqual(expect.objectContaining({ status: 'processed' }));
    const settlementSchedule = fixture.scheduler.calls.at(-1);
    expect(settlementSchedule?.delay).toBe(registration.activityDuration);
    expect(settlementSchedule?.args.operationId).toBe(registration.operationId);
    expect(settlementSchedule?.args.lastAttemptAt).toBe(activityUntil);
    const processedSchedulerCount = fixture.scheduler.calls.length;
    expect(await processActivityRegistrationAckOutbox(fixture.ctx, {
      outboxId: outbox._id as Id<'activityRegistrationAcks'>,
    })).toEqual({ status: 'already-processed' });
    expect(fixture.scheduler.calls).toHaveLength(processedSchedulerCount);
    expect(readFileSync('convex/aiTown/game.ts', 'utf8'))
      .toContain('await applyCompletedActivityRegistrationAcks');
    const operationsSource = readFileSync('convex/aiTown/agentOperations.ts', 'utf8');
    expect(operationsSource).toContain('export async function processActivityRegistrationAckOutbox');
    expect(operationsSource).toContain('export async function recordActivityRegistrationAckFailure');
    expect(operationsSource)
      .toContain('export async function dispatchActivityRegistrationAckWithRecovery');
    expect(operationsSource)
      .toContain('export async function persistActivitySettlementRetryState');
    expect(operationsSource)
      .toContain('export async function wakeOutstandingActivitySettlements');
    expect(operationsSource).toContain('ctx.runMutation(');
  });

  test('persists bounded paused settlement state and wakes outstanding work once on resume', async () => {
    const { fixture, queued, registration } = await makeLinkedActivityFixture('o:wake:paused');
    const activatedAt = now;
    const activityUntil = now + 60_000;
    await applyCompletedActivityRegistrationAcks(fixture.ctx, worldId, [{
      inputId: queued.inputId as Id<'inputs'>,
      returnValue: {
        kind: 'ok',
        value: {
          activityRegistration: {
            registrationId: registration._id,
            operationId: registration.operationId,
            agentId: registration.agentId,
            residentId: registration.residentId,
            status: 'activated',
            activatedAt,
            activityUntil,
          },
        },
      },
    }]);
    const outbox = fixture.db.table('activityRegistrationAcks')[0];
    await processActivityRegistrationAckOutbox(fixture.ctx, {
      outboxId: outbox._id as Id<'activityRegistrationAcks'>,
    });

    expect(await persistActivitySettlementRetryState(fixture.ctx, {
      worldId,
      operationId: registration.operationId as string,
      arrivalGraceStartedAt: now + 16_000,
      arrivalRecoveryDeadline: now + 300_000,
      lastAttemptAt: now + 20_000,
      pauseRetryCount: 4,
    })).toEqual({ status: 'persisted' });
    expect(registration).toEqual(expect.objectContaining({
      settlementArrivalGraceStartedAt: now + 16_000,
      settlementArrivalRecoveryDeadline: now + 300_000,
      settlementLastAttemptAt: now + 20_000,
      settlementPauseRetryCount: 4,
    }));

    const beforeWake = fixture.scheduler.calls.length;
    const resumedAt = now + 24 * 60 * 60 * 1_000 + 20_000;
    expect(await wakeOutstandingActivitySettlements(fixture.ctx, {
      worldId,
      now: resumedAt,
    })).toEqual({ scheduled: 1 });
    expect(fixture.scheduler.calls).toHaveLength(beforeWake + 1);
    const wakeCall = fixture.scheduler.calls.at(-1);
    expect(wakeCall?.delay).toBe(0);
    expect(wakeCall?.args).toEqual(expect.objectContaining({
      operationId: registration.operationId,
      arrivalGraceStartedAt: now + 24 * 60 * 60 * 1_000 + 16_000,
      arrivalRecoveryDeadline: now + 24 * 60 * 60 * 1_000 + 300_000,
      lastAttemptAt: resumedAt,
      pauseRetryCount: 0,
    }));
    expect(registration).toEqual(expect.objectContaining({
      settlementArrivalGraceStartedAt: now + 24 * 60 * 60 * 1_000 + 16_000,
      settlementArrivalRecoveryDeadline: now + 24 * 60 * 60 * 1_000 + 300_000,
      settlementLastAttemptAt: resumedAt,
    }));
    expect((wakeCall?.args.arrivalGraceStartedAt as number) + 8_000 - resumedAt).toBe(4_000);
    expect((wakeCall?.args.arrivalRecoveryDeadline as number) - resumedAt).toBe(280_000);
    expect(await wakeOutstandingActivitySettlements(fixture.ctx, {
      worldId,
      now: resumedAt + 1,
    })).toEqual({ scheduled: 0 });
    expect(fixture.scheduler.calls).toHaveLength(beforeWake + 1);

    expect(readFileSync('convex/world.ts', 'utf8'))
      .toContain('wakeOutstandingActivitySettlementsMutation');
    expect(readFileSync('convex/testing.ts', 'utf8'))
      .toContain('wakeOutstandingActivitySettlementsMutation');
  });

  test('terminates a server-linked engine input error without creating economic facts', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    addRuntimeResident(fixture.db, '唐果', 'p:2');
    const base = workSettlementArgs();
    const queued = await enqueueResidentActivityInput(fixture.ctx, {
      worldId,
      residentId: base.residentId,
      agentId: 'a:2',
      operationId: 'o:work:error',
      activityText: base.activityText,
      activityDuration: 60_000,
      landmarkId: base.landmarkId,
      category: base.category,
      economicAction: base.economicAction,
      startedAt: now,
      destination: { x: 5, y: 20 },
      emoji: '🍵',
    });
    const persistedError = await applyCompletedActivityRegistrationAcks(fixture.ctx, worldId, [{
      inputId: queued.inputId as Id<'inputs'>,
      returnValue: { kind: 'error', message: 'x'.repeat(500) },
    }]);
    expect(persistedError[0]?.status).toBe('persisted');
    expect(fixture.db.table('activityRegistrations')[0]).toEqual(expect.objectContaining({
      state: 'intent',
      deliveryState: 'processing',
    }));
    const outbox = fixture.db.table('activityRegistrationAcks')[0];
    expect(JSON.parse(outbox.payloadJson as string)).toEqual({ message: 'x'.repeat(240) });
    expect(await processActivityRegistrationAckOutbox(fixture.ctx, {
      outboxId: outbox._id as Id<'activityRegistrationAcks'>,
    })).toEqual({ status: 'abandoned' });
    expect(fixture.db.table('activityRegistrations')[0]).toEqual(expect.objectContaining({
      state: 'abandoned',
      deliveryState: 'failed',
      abandonReason: 'engine-input-error',
    }));
    expect(fixture.db.table('lifeEvents')).toHaveLength(0);
    expect(fixture.db.table('economyLedger')).toHaveLength(0);
    expect(fixture.scheduler.calls).toHaveLength(1);
  });

  test('durably terminates a server-linked completed input with a missing acknowledgement', async () => {
    await expectInvalidAckTerminal(
      'o:work:missing-ack',
      'missing-ack',
      () => ({ kind: 'ok', value: {} }),
    );
  });

  test('durably terminates a server-linked completed input with a malformed acknowledgement', async () => {
    await expectInvalidAckTerminal(
      'o:work:malformed-ack',
      'malformed-ack',
      () => ({ kind: 'ok', value: '{invalid-json' }),
    );
  });

  test('durably terminates a server-linked completed input with mismatched fields', async () => {
    await expectInvalidAckTerminal(
      'o:work:mismatched-ack',
      'mismatched-ack',
      (registration) => ({
        kind: 'ok',
        value: {
          activityRegistration: {
            registrationId: registration._id,
            operationId: registration.operationId,
            agentId: 'a:forged',
            residentId: registration.residentId,
            status: 'activated',
            activatedAt: now,
            activityUntil: now + 60_000,
          },
        },
      }),
    );
  });

  test('dead-letters a consumed acknowledgement after bounded processing failures', async () => {
    const fixture = makeContext();
    seedWorldStatus(fixture.db, 'running');
    addRuntimeResident(fixture.db, '唐果', 'p:2');
    const base = workSettlementArgs();
    const queued = await enqueueResidentActivityInput(fixture.ctx, {
      worldId,
      residentId: base.residentId,
      agentId: 'a:2',
      operationId: 'o:work:dead-letter',
      activityText: base.activityText,
      activityDuration: 60_000,
      landmarkId: base.landmarkId,
      category: base.category,
      economicAction: base.economicAction,
      startedAt: now,
      destination: { x: 5, y: 20 },
    });
    const registration = fixture.db.table('activityRegistrations')[0];
    await applyCompletedActivityRegistrationAcks(fixture.ctx, worldId, [{
      inputId: queued.inputId as Id<'inputs'>,
      returnValue: {
        kind: 'ok',
        value: {
          activityRegistration: {
            registrationId: registration._id,
            operationId: registration.operationId,
            agentId: registration.agentId,
            residentId: registration.residentId,
            status: 'activated',
            activatedAt: now,
            activityUntil: now + 60_000,
          },
        },
      },
    }]);
    const outbox = fixture.db.table('activityRegistrationAcks')[0];
    outbox.payloadJson = '{invalid-json';
    await expect(processActivityRegistrationAckOutbox(fixture.ctx, {
      outboxId: outbox._id as Id<'activityRegistrationAcks'>,
    })).rejects.toThrow();
    await recordActivityRegistrationAckFailure(fixture.ctx, {
      outboxId: outbox._id as Id<'activityRegistrationAcks'>,
      errorCode: 'first',
    });
    await recordActivityRegistrationAckFailure(fixture.ctx, {
      outboxId: outbox._id as Id<'activityRegistrationAcks'>,
      errorCode: 'second',
    });
    const scheduledBeforeTerminal = fixture.scheduler.calls.length;
    expect(await recordActivityRegistrationAckFailure(fixture.ctx, {
      outboxId: outbox._id as Id<'activityRegistrationAcks'>,
      errorCode: 'third',
    })).toEqual({ status: 'dead-letter', attempts: 3 });
    expect(fixture.scheduler.calls).toHaveLength(scheduledBeforeTerminal);
    expect(outbox).toEqual(expect.objectContaining({
      status: 'dead-letter',
      attempts: 3,
      errorCode: 'ack-processing-failed',
    }));
    expect(registration).toEqual(expect.objectContaining({
      state: 'abandoned',
      deliveryState: 'failed',
      abandonReason: 'ack-processing-failed',
      recoveryAttempts: 3,
    }));
  });
});

type SettlementOverrides = {
  activityText?: string;
  now?: number;
  position?: { x: number; y: number };
  status?: 'running' | 'stoppedByDeveloper';
  startingBalance?: number;
  dailyAdvanced?: boolean;
};

function settlementContext(overrides: SettlementOverrides = {}) {
  const fixture = makeContext();
  seedWorldStatus(fixture.db, overrides.status ?? 'running');
  if (overrides.dailyAdvanced !== false) {
    fixture.db.seed('dailyEconomyDays', {
      worldId,
      dayKey: shanghaiEconomyDayKey(overrides.now ?? now),
      advancedAt: overrides.now ?? now,
    });
  }
  addSettlementResident(
    fixture.db,
    overrides.position ?? { x: 5, y: 20 },
    overrides.activityText ?? workSettlementArgs().activityText,
  );
  if (overrides.startingBalance !== undefined) {
    fixture.db.seed('residentEconomy', validResidentRow({
      residentId: 'p:2',
      profileId: 'tang-guo',
      balance: overrides.startingBalance,
      initialBalance: 150,
      initializationSourceKey: 'economy-definition:resident:tang-guo:v1',
    }));
  }
  return fixture;
}

function addSettlementResident(
  db: MemoryDb,
  position: { x: number; y: number },
  activityText: string,
) {
  addRuntimeResident(db, '唐果', 'p:2');
  const world = db.table('worlds').find((row) => row._id === worldId)!;
  const player = (world.players as Array<Record<string, unknown>>)[0];
  Object.assign(player, {
    position,
    activity: { description: activityText, emoji: '🍵', until: now },
  });
  seedActivityStart(db, 'o:work:1', activityText);
}

function seedActivityStart(db: MemoryDb, operationId: string, activityText: string) {
  const action = operationId.includes('purchase')
    ? purchaseSettlementArgs().economicAction
    : operationId.includes('rest')
      ? { kind: 'rest' as const }
      : workSettlementArgs().economicAction;
  const landmarkId = operationId.includes('purchase')
    ? 'restaurant'
    : operationId.includes('rest') ? 'morning-market' : 'tea-house';
  db.seed('lifeEvents', {
    worldId,
    residentId: 'p:2',
    kind: operationId.includes('purchase') ? 'food' : operationId.includes('rest') ? 'care' : 'work',
    text: `开始${activityText}`,
    createdAt: now - 1,
    sourceKey: `activity:${operationId}:start`,
    operationId,
    phase: 'start',
    category: operationId.includes('purchase') ? 'food' : operationId.includes('rest') ? 'care' : 'work',
    landmarkId,
    economicActionJson: JSON.stringify(action),
    activityUntil: now,
  });
}

function workSettlementArgs(overrides: SettlementOverrides = {}) {
  return {
    worldId,
    residentId: 'p:2',
    operationId: 'o:work:1',
    activityText: overrides.activityText ?? '在听雨茶庄：在临桥茶馆招呼客人并盘点今日茶叶',
    activityUntil: now,
    landmarkId: 'tea-house' as const,
    category: 'work' as const,
    economicAction: {
      kind: 'work' as const,
      institutionId: 'tea-house' as const,
      output: { kind: 'stock' as const, item: 'tea' as const, quantity: 3 },
    },
    now: overrides.now ?? now,
  };
}

function purchaseSettlementArgs() {
  const text = workSettlementArgs().activityText;
  return {
    worldId,
    residentId: 'p:2',
    operationId: 'o:purchase:1',
    activityText: text,
    activityUntil: now,
    landmarkId: 'restaurant' as const,
    category: 'food' as const,
    economicAction: {
      kind: 'purchase' as const,
      institutionId: 'restaurant' as const,
      goodId: 'meal' as const,
      quantity: 1 as const,
    },
    now,
  };
}

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
