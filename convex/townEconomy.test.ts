import { readFileSync } from 'node:fs';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { residentEconomyProfiles } from '../data/worlds/lighthouse-town/economy';
import {
  appendEconomyLedger,
  initializeTownEconomy,
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

function makeContext() {
  const db = new MemoryDb();
  return { db, ctx: { db } as unknown as MutationCtx };
}

const worldId = 'worlds:test' as Id<'worlds'>;
const now = Date.parse('2026-07-19T09:30:00+08:00');

function seedRuntimeResidents(db: MemoryDb, profiles = residentEconomyProfiles) {
  profiles.forEach((profile, index) => {
    db.seed('playerDescriptions', {
      worldId,
      playerId: `p:${index}`,
      name: profile.name,
    });
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
    expect(initSource).toMatch(/export const reconcileTownEconomy\s*=\s*internalMutation/u);
  });

  test('initializes exactly nine runtime resident accounts and nine institutions once', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);

    const first = await initializeTownEconomy(ctx, worldId, now);
    const second = await initializeTownEconomy(ctx, worldId, now + 1_000);

    expect(first).toEqual({ residentCount: 9, institutionCount: 9, missingResidentNames: [] });
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

    db.seed('playerDescriptions', {
      worldId,
      playerId: 'p:8',
      name: '玄微先生',
    });
    const complete = await initializeTownEconomy(ctx, worldId, now + 20_000);

    expect(complete.residentCount).toBe(9);
    expect(complete.missingResidentNames).toEqual([]);
    expect(db.table('residentEconomy')).toHaveLength(9);
    expect(db.table('townInstitutions')).toHaveLength(9);
  });

  test('stores factual daily flow, offered stock and service counters separately', async () => {
    const { db, ctx } = makeContext();
    seedRuntimeResidents(db);
    await initializeTownEconomy(ctx, worldId, now);

    expect(db.table('residentEconomy')[0]).toEqual(expect.objectContaining({
      profileId: 'lin-lan',
      balance: 120,
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
      stockJson: JSON.stringify({ 'craft-service': 99 }),
      serviceCountersJson: JSON.stringify({ repair: 0, 'lantern-making': 0 }),
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
  });

  test('appends one immutable factual ledger row per stable idempotency key', async () => {
    const { db, ctx } = makeContext();
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
      sourceKey: 'activity:o:4',
      text: '唐果完成一次茶叶备货，实际支取 16 金贝。',
      createdAt: now,
    };

    expect(await appendEconomyLedger(ctx, entry)).toBe(true);
    expect(await appendEconomyLedger(ctx, { ...entry, amount: 999, text: '虚构改写' })).toBe(false);
    expect(db.table('economyLedger')).toHaveLength(1);
    expect(db.table('economyLedger')[0]).toEqual(expect.objectContaining(entry));
  });

  test('rejects malformed or non-factual ledger values before persistence', async () => {
    const { db, ctx } = makeContext();
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
});
