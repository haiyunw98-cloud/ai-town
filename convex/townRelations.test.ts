import { readFileSync } from 'node:fs';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { residentLifeProfiles } from '../data/worlds/lighthouse-town/lives';
import {
  initializeTownRelations,
  recordCompletedConversationContact,
  recordInstitutionPurchaseTrade,
  recordRelationEvent,
  reconcileTownRelationsAfterAgentCreation,
} from './townRelations';
import { rememberConversationAndRelease } from './aiTown/agentOperations';

type StoredRow = Record<string, unknown> & { _id: string; _creationTime: number };

class MemoryDb {
  private nextId = 1;
  readonly rows = new Map<string, StoredRow[]>();
  failPatch = false;

  seed(table: string, row: Record<string, unknown>) {
    const stored = {
      _id: `${table}:${this.nextId++}`,
      _creationTime: now,
      ...row,
    };
    this.table(table).push(stored);
    return stored;
  }

  query(table: string) {
    const filters: Array<[string, unknown]> = [];
    let order: 'asc' | 'desc' = 'asc';
    const query = {
      withIndex: (
        _index: string,
        apply: (builder: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        const builder = {
          eq: (field: string, value: unknown) => {
            filters.push([field, value]);
            return builder;
          },
        };
        apply(builder);
        return query;
      },
      collect: () => Promise.resolve(this.matching(table, filters)),
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
    if (this.failPatch) throw new Error('patch-failed');
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
  runAfter(delay: number, _reference: unknown, args: Record<string, unknown>) {
    this.calls.push({ delay, args });
    return Promise.resolve('scheduled:test');
  }
}

const worldId = 'worlds:test' as Id<'worlds'>;
const now = Date.parse('2026-07-19T09:30:00+08:00');

function fixture(status: 'running' | 'stoppedByDeveloper' | 'inactive' = 'running') {
  const db = new MemoryDb();
  const scheduler = new MemoryScheduler();
  const ctx = { db, scheduler } as unknown as MutationCtx;
  db.seed('worlds', {
    _id: worldId,
    nextId: 0,
    players: [],
    agents: [],
    conversations: [],
  });
  db.seed('worldStatus', {
    worldId,
    isDefault: true,
    engineId: 'engines:test',
    lastViewed: now,
    status,
  });
  return { db, scheduler, ctx };
}

function addResident(
  db: MemoryDb,
  profileIndex: number,
  options: { playerId?: string; human?: string; agent?: boolean } = {},
) {
  const profile = residentLifeProfiles[profileIndex];
  const playerId = options.playerId ?? `p:${profileIndex}`;
  db.seed('playerDescriptions', { worldId, playerId, name: profile.name });
  const world = db.table('worlds')[0];
  (world.players as Array<Record<string, unknown>>).push({ id: playerId, human: options.human });
  if (options.agent !== false) {
    (world.agents as Array<Record<string, unknown>>).push({
      id: `a:${profileIndex}`,
      playerId,
    });
  }
  return playerId;
}

function addAllResidents(db: MemoryDb) {
  return residentLifeProfiles.map((_profile, index) => addResident(db, index));
}

function event(
  kind: 'conversation' | 'cooperation' | 'trade' | 'care' | 'reciprocal-affection' | 'dispute',
  key = `${kind}:1`,
  overrides: Partial<Parameters<typeof recordRelationEvent>[1]> = {},
) {
  return {
    worldId,
    idempotencyKey: key,
    residentA: 'p:1',
    residentB: 'p:0',
    kind,
    sourceKey: `source:${key}`,
    text: `结构化事实 ${key}`,
    createdAt: now,
    ...overrides,
  } as Parameters<typeof recordRelationEvent>[1];
}

function relation(db: MemoryDb, a = 'p:0', b = 'p:1') {
  return db.table('townRelationships').find((row) => row.residentA === a && row.residentB === b)!;
}

async function runAtomic<T>(state: ReturnType<typeof fixture>, operation: () => Promise<T>) {
  const snapshot = state.db.snapshot();
  try {
    return await operation();
  } catch (error) {
    state.db.restore(snapshot);
    throw error;
  }
}

describe('town relationship persistence', () => {
  test('wires initialization, delayed reconciliation and post-memory contact recording', () => {
    const initSource = readFileSync('convex/init.ts', 'utf8');
    const operationSource = readFileSync('convex/aiTown/agentOperations.ts', 'utf8');
    expect(initSource).toContain('initializeTownRelations');
    expect(initSource).toContain('reconcileTownRelationsAfterAgentCreation');
    expect(operationSource).toContain('recordConversationContact');
    expect(operationSource).toMatch(/rememberConversationAndRelease[\s\S]*recordContact/u);
  });

  test('declares provenance-compatible relationship and append-only change indexes', () => {
    const schema = readFileSync('convex/schema.ts', 'utf8');
    expect(schema).toContain('townRelationships: defineTable');
    expect(schema).toContain('relationshipChanges: defineTable');
    expect(schema).toContain(".index('pair', ['worldId', 'residentA', 'residentB'])");
    expect(schema).toContain(".index('worldResidentA', ['worldId', 'residentA'])");
    expect(schema).toContain(".index('worldResidentB', ['worldId', 'residentB'])");
    expect(schema).toContain(".index('idempotencyKey', ['worldId', 'idempotencyKey'])");
    expect(schema).toContain(".index('pairDay', ['worldId', 'residentA', 'residentB', 'dayKey'])");
    expect(schema).toContain('initializationSourceKey: v.optional(v.string())');
  });

  test('initializes all 36 sorted adult pairs once from static starting context', async () => {
    const state = fixture();
    addAllResidents(state.db);

    expect(await initializeTownRelations(state.ctx, worldId, now)).toMatchObject({
      relationshipCount: 36,
      missingResidentNames: [],
      conflictingResidentNames: [],
    });
    await initializeTownRelations(state.ctx, worldId, now);

    expect(state.db.table('townRelationships')).toHaveLength(36);
    expect(
      state.db
        .table('townRelationships')
        .every((row) => String(row.residentA) < String(row.residentB)),
    ).toBe(true);
    expect(relation(state.db, 'p:0', 'p:1')).toEqual(
      expect.objectContaining({
        friendship: 40,
        trust: 40,
        attraction: 0,
        business: 20,
        initializationSourceKey: 'lives-definition:pair:lin-lan:shen-yan:v1',
      }),
    );
    expect(relation(state.db, 'p:1', 'p:2')).toEqual(
      expect.objectContaining({
        attraction: 78,
        business: 69,
      }),
    );
  });

  test('reconciles delayed residents and schedules bounded retries', async () => {
    const state = fixture();
    addResident(state.db, 0);
    addResident(state.db, 1);
    expect(
      await reconcileTownRelationsAfterAgentCreation(state.ctx, {
        worldId,
        attempt: 0,
        now,
      }),
    ).toMatchObject({ status: 'retrying', relationshipCount: 1, nextAttempt: 1 });
    expect(state.scheduler.calls).toHaveLength(1);
    for (let index = 2; index < residentLifeProfiles.length; index += 1) {
      addResident(state.db, index);
    }
    expect(
      await reconcileTownRelationsAfterAgentCreation(state.ctx, {
        worldId,
        attempt: 1,
        now,
      }),
    ).toMatchObject({ status: 'complete', relationshipCount: 36 });
  });

  test('fails closed on duplicate, unsorted, invalid-bound and identity-conflicting rows', async () => {
    for (const corrupt of ['duplicate', 'unsorted', 'bound', 'identity'] as const) {
      const state = fixture();
      addAllResidents(state.db);
      await initializeTownRelations(state.ctx, worldId, now);
      const first = state.db.table('townRelationships')[0];
      if (corrupt === 'duplicate')
        state.db.seed('townRelationships', { ...first, _id: 'duplicate' });
      if (corrupt === 'unsorted')
        [first.residentA, first.residentB] = [first.residentB, first.residentA];
      if (corrupt === 'bound') first.trust = 101;
      if (corrupt === 'identity') {
        const world = state.db.table('worlds')[0];
        (world.players as Array<Record<string, unknown>>)[0].human = 'observer';
      }
      await expect(initializeTownRelations(state.ctx, worldId, now)).rejects.toThrow();
    }
  });

  test('backfills optional legacy provenance but rejects conflicting provenance', async () => {
    const state = fixture();
    addAllResidents(state.db);
    await initializeTownRelations(state.ctx, worldId, now);
    const row = relation(state.db);
    delete row.initializationSourceKey;
    delete row.initializedAt;
    delete row.initialFriendship;
    await initializeTownRelations(state.ctx, worldId, now);
    expect(row).toEqual(
      expect.objectContaining({
        initializationSourceKey: 'lives-definition:pair:lin-lan:shen-yan:v1',
        initializedAt: now,
        initialFriendship: 40,
      }),
    );
    row.initializationSourceKey = 'forged';
    await expect(initializeTownRelations(state.ctx, worldId, now)).rejects.toThrow(
      /initialization source/u,
    );
  });

  test('sorts undirected pairs and records conversation as zero-delta contact exactly once', async () => {
    const state = fixture();
    addAllResidents(state.db);
    await initializeTownRelations(state.ctx, worldId, now);
    const before = { ...relation(state.db) };

    expect(await recordRelationEvent(state.ctx, event('conversation'))).toEqual({
      status: 'recorded',
      deltas: { friendship: 0, trust: 0, attraction: 0, business: 0 },
    });
    expect(await recordRelationEvent(state.ctx, event('conversation'))).toEqual({
      status: 'already-recorded',
      deltas: { friendship: 0, trust: 0, attraction: 0, business: 0 },
    });
    expect(state.db.table('relationshipChanges')).toHaveLength(1);
    expect(state.db.table('relationshipChanges')[0]).toEqual(
      expect.objectContaining({
        residentA: 'p:0',
        residentB: 'p:1',
        dayKey: '2026-07-19',
        friendshipDelta: 0,
        trustDelta: 0,
        attractionDelta: 0,
        businessDelta: 0,
      }),
    );
    expect(relation(state.db)).toEqual(
      expect.objectContaining({
        friendship: before.friendship,
        trust: before.trust,
        attraction: before.attraction,
        business: before.business,
      }),
    );
  });

  test('applies small cooperation, trade, care and dispute deltas with per-kind daily caps', async () => {
    const expected = {
      cooperation: { friendship: 1, trust: 1, attraction: 0, business: 0 },
      trade: { friendship: 0, trust: 1, attraction: 0, business: 1 },
      care: { friendship: 2, trust: 1, attraction: 0, business: 0 },
      dispute: { friendship: -2, trust: -1, attraction: 0, business: 0 },
    } as const;
    for (const kind of Object.keys(expected) as Array<keyof typeof expected>) {
      const state = fixture();
      addAllResidents(state.db);
      await initializeTownRelations(state.ctx, worldId, now);
      const before = { ...relation(state.db) };
      const results = [];
      for (let index = 0; index < 8; index += 1) {
        results.push(await recordRelationEvent(state.ctx, event(kind, `${kind}:${index}`)));
      }
      expect(results[0]).toEqual({ status: 'recorded', deltas: expected[kind] });
      expect(results.at(-1)).toEqual({
        status: 'recorded',
        deltas: { friendship: 0, trust: 0, attraction: 0, business: 0 },
      });
      const after = relation(state.db);
      expect(after.friendship).toBeGreaterThanOrEqual(0);
      expect(after.friendship).toBeLessThanOrEqual(100);
      expect(after.trust).toBeGreaterThanOrEqual(0);
      expect(after.trust).toBeLessThanOrEqual(100);
      expect(after.business).toBeGreaterThanOrEqual(0);
      expect(after.business).toBeLessThanOrEqual(100);
      expect(after).not.toEqual(before);
    }
  });

  test('clamps dimensions at 0 and 100 while preserving the actual applied deltas', async () => {
    const high = fixture();
    addAllResidents(high.db);
    await initializeTownRelations(high.ctx, worldId, now);
    relation(high.db).friendship = 100;
    const positive = await recordRelationEvent(high.ctx, event('care'));
    expect(positive.deltas.friendship).toBe(0);
    expect(relation(high.db).friendship).toBe(100);

    const low = fixture();
    addAllResidents(low.db);
    await initializeTownRelations(low.ctx, worldId, now);
    relation(low.db).friendship = 1;
    const negative = await recordRelationEvent(low.ctx, event('dispute'));
    expect(negative.deltas.friendship).toBe(-1);
    expect(relation(low.db).friendship).toBe(0);
  });

  test('changes attraction only for explicit reciprocal affection and never from prose', async () => {
    const state = fixture();
    addAllResidents(state.db);
    await initializeTownRelations(state.ctx, worldId, now);
    const before = Number(relation(state.db).attraction);

    await recordRelationEvent(
      state.ctx,
      event('care', 'care:romantic-prose', {
        text: '双方在散文里写了相爱、心动、约会。',
      }),
    );
    await recordRelationEvent(
      state.ctx,
      event('reciprocal-affection', 'affection:no', {
        reciprocal: false,
      }),
    );
    expect(relation(state.db).attraction).toBe(before);
    const yes = await recordRelationEvent(
      state.ctx,
      event('reciprocal-affection', 'affection:yes', { reciprocal: true }),
    );
    expect(yes.deltas.attraction).toBe(1);
    expect(relation(state.db).attraction).toBe(before + 1);
  });

  test('treats exact keys as idempotent and different facts as collisions', async () => {
    const state = fixture();
    addAllResidents(state.db);
    await initializeTownRelations(state.ctx, worldId, now);
    const original = event('trade', 'stable:key');
    await recordRelationEvent(state.ctx, original);
    await expect(
      recordRelationEvent(state.ctx, {
        ...original,
        text: '不同事实',
      }),
    ).rejects.toThrow(/collision/u);
    expect(state.db.table('relationshipChanges')).toHaveLength(1);
  });

  test('fails closed on malformed persisted append-only deltas before applying a new event', async () => {
    const state = fixture();
    addAllResidents(state.db);
    await initializeTownRelations(state.ctx, worldId, now);
    state.db.seed('relationshipChanges', {
      worldId,
      idempotencyKey: 'care:corrupt',
      residentA: 'p:0',
      residentB: 'p:1',
      kind: 'care',
      friendshipDelta: 99,
      trustDelta: 1,
      attractionDelta: 0,
      businessDelta: 0,
      dayKey: '2026-07-19',
      sourceKey: 'source:care:corrupt',
      text: '损坏的旧关系变化',
      createdAt: now,
    });
    await expect(recordRelationEvent(state.ctx, event('care', 'care:next'))).rejects.toThrow(
      /persisted relationship change/u,
    );
    expect(relation(state.db).friendship).toBe(40);
  });

  test('records no changes in paused worlds', async () => {
    const state = fixture('stoppedByDeveloper');
    addAllResidents(state.db);
    expect(await recordRelationEvent(state.ctx, event('care'))).toEqual({
      status: 'world-not-running',
      deltas: { friendship: 0, trust: 0, attraction: 0, business: 0 },
    });
    expect(state.db.table('townRelationships')).toHaveLength(0);
    expect(state.db.table('relationshipChanges')).toHaveLength(0);
  });

  test('does not call memory, contact recording or a model path while paused', async () => {
    const calls: string[] = [];
    await rememberConversationAndRelease({
      isWorldRunning: async () => false,
      remember: async () => void calls.push('remember'),
      recordContact: async () => void calls.push('contact'),
      release: async () => void calls.push('release'),
    });
    expect(calls).toEqual(['release']);
  });

  test('still records verified completed contact when local memory work fails', async () => {
    const calls: string[] = [];
    await expect(
      rememberConversationAndRelease({
        isWorldRunning: async () => true,
        remember: async () => {
          calls.push('remember');
          throw new Error('memory-unavailable');
        },
        recordContact: async () => void calls.push('contact'),
        release: async () => void calls.push('release'),
      }),
    ).rejects.toThrow('memory-unavailable');
    expect(calls).toEqual(['remember', 'contact', 'release']);
  });

  test('does not move relationship updatedAt backward for a delayed older fact', async () => {
    const state = fixture();
    addAllResidents(state.db);
    await initializeTownRelations(state.ctx, worldId, now);
    await recordRelationEvent(state.ctx, event('care', 'care:new', { createdAt: now + 10_000 }));
    await recordRelationEvent(state.ctx, event('trade', 'trade:old', { createdAt: now + 1_000 }));
    expect(relation(state.db).updatedAt).toBe(now + 10_000);
  });

  test('relies on mutation rollback to keep row and append-only fact atomic', async () => {
    const state = fixture();
    addAllResidents(state.db);
    await initializeTownRelations(state.ctx, worldId, now);
    const before = structuredClone(relation(state.db));
    state.db.failPatch = true;
    await expect(
      runAtomic(state, () => recordRelationEvent(state.ctx, event('care'))),
    ).rejects.toThrow('patch-failed');
    expect(relation(state.db)).toEqual(before);
    expect(state.db.table('relationshipChanges')).toHaveLength(0);
  });

  test('records one completed two-resident conversation and excludes human observers', async () => {
    const state = fixture();
    addAllResidents(state.db);
    await initializeTownRelations(state.ctx, worldId, now);
    state.db.seed('archivedConversations', {
      worldId,
      id: 'c:1',
      creator: 'p:0',
      created: now - 60_000,
      ended: now,
      numMessages: 3,
      participants: ['p:1', 'p:0'],
    });
    await recordCompletedConversationContact(state.ctx, { worldId, conversationId: 'c:1' });
    await recordCompletedConversationContact(state.ctx, { worldId, conversationId: 'c:1' });
    expect(state.db.table('relationshipChanges')).toHaveLength(1);
    expect(state.db.table('relationshipChanges')[0]).toEqual(
      expect.objectContaining({
        idempotencyKey: `conversation:${worldId}:c:1:pair`,
        kind: 'conversation',
      }),
    );

    const human = fixture();
    addAllResidents(human.db);
    addResident(human.db, 0, { playerId: 'human:1', human: 'observer', agent: false });
    human.db.seed('archivedConversations', {
      worldId,
      id: 'c:human',
      creator: 'human:1',
      created: now - 10_000,
      ended: now,
      numMessages: 4,
      participants: ['human:1', 'p:1'],
    });
    expect(
      await recordCompletedConversationContact(human.ctx, {
        worldId,
        conversationId: 'c:human',
      }),
    ).toEqual({ status: 'excluded-participants' });
    expect(human.db.table('relationshipChanges')).toHaveLength(0);
  });

  test('records a real purchase only when buyer differs from one uniquely owned institution', async () => {
    const state = fixture();
    addAllResidents(state.db);
    await initializeTownRelations(state.ctx, worldId, now);
    state.db.seed('residentEconomy', { worldId, residentId: 'p:2', profileId: 'tang-guo' });
    state.db.seed('residentEconomy', { worldId, residentId: 'p:0', profileId: 'lin-lan' });

    expect(
      await recordInstitutionPurchaseTrade(state.ctx, {
        worldId,
        buyerResidentId: 'p:0',
        institutionId: 'tea-house',
        item: 'tea',
        quantity: 1,
        economyIdempotencyKey: 'activity:purchase:tea:1',
        economySourceKey: 'activity:purchase:tea',
        createdAt: now,
      }),
    ).toMatchObject({ status: 'recorded', deltas: { trust: 1, business: 1 } });
    expect(
      await recordInstitutionPurchaseTrade(state.ctx, {
        worldId,
        buyerResidentId: 'p:2',
        institutionId: 'tea-house',
        item: 'tea',
        quantity: 1,
        economyIdempotencyKey: 'activity:purchase:self:1',
        economySourceKey: 'activity:purchase:self',
        createdAt: now,
      }),
    ).toEqual({ status: 'same-resident' });
    expect(
      await recordInstitutionPurchaseTrade(state.ctx, {
        worldId,
        buyerResidentId: 'p:0',
        institutionId: 'restaurant',
        item: 'meal',
        quantity: 1,
        economyIdempotencyKey: 'activity:purchase:meal:1',
        economySourceKey: 'activity:purchase:meal',
        createdAt: now,
      }),
    ).toEqual({ status: 'no-unique-owner' });
    expect(state.db.table('relationshipChanges')).toHaveLength(1);
    expect(readFileSync('convex/townEconomy.ts', 'utf8')).toContain(
      'recordInstitutionPurchaseTrade',
    );
  });
});
