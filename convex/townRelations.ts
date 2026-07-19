import { v } from 'convex/values';
import { residentLifeProfiles } from '../data/worlds/lighthouse-town/lives';
import { residentEconomyProfiles } from '../data/worlds/lighthouse-town/economy';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const MAX_TIMESTAMP = Date.parse('9999-12-31T15:59:59.999Z');
const MAX_RECONCILIATION_ATTEMPTS = 5;
const MAX_KEY_LENGTH = 200;
const MAX_TEXT_LENGTH = 500;
const KEY = /^[a-z0-9][a-z0-9:._-]*$/u;

export type RelationEventKind =
  | 'conversation'
  | 'cooperation'
  | 'trade'
  | 'care'
  | 'reciprocal-affection'
  | 'dispute';

export type RelationEvent = {
  worldId: Id<'worlds'>;
  idempotencyKey: string;
  residentA: string;
  residentB: string;
  kind: RelationEventKind;
  reciprocal?: boolean;
  sourceKey: string;
  text: string;
  createdAt: number;
};

type RelationContext = Pick<MutationCtx, 'db'>;
type ReconciliationContext = Pick<MutationCtx, 'db' | 'scheduler'>;
type Dimensions = {
  friendship: number;
  trust: number;
  attraction: number;
  business: number;
};

const ZERO: Dimensions = { friendship: 0, trust: 0, attraction: 0, business: 0 };

const EVENT_DELTAS: Record<Exclude<RelationEventKind, 'reciprocal-affection'>, Dimensions> = {
  conversation: ZERO,
  cooperation: { friendship: 1, trust: 1, attraction: 0, business: 0 },
  trade: { friendship: 0, trust: 1, attraction: 0, business: 1 },
  care: { friendship: 2, trust: 1, attraction: 0, business: 0 },
  dispute: { friendship: -2, trust: -1, attraction: 0, business: 0 },
};

const DAILY_CAPS: Record<RelationEventKind, Dimensions> = {
  conversation: ZERO,
  cooperation: { friendship: 3, trust: 3, attraction: 0, business: 0 },
  trade: { friendship: 0, trust: 3, attraction: 0, business: 3 },
  care: { friendship: 4, trust: 2, attraction: 0, business: 0 },
  'reciprocal-affection': { friendship: 0, trust: 0, attraction: 1, business: 0 },
  dispute: { friendship: -4, trust: -2, attraction: 0, business: 0 },
};

export function shanghaiRelationDayKey(timestamp: number) {
  assertTimestamp(timestamp, 'createdAt');
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export async function initializeTownRelations(
  ctx: RelationContext,
  worldId: Id<'worlds'>,
  now = Date.now(),
) {
  assertTimestamp(now, 'updatedAt');
  const world = await ctx.db.get(worldId);
  if (!world) throw new Error('Town relationship runtime world is missing');
  const descriptions = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .collect();
  const identity = resolveRuntimeResidentIdentity(world, descriptions);
  const expectedByPair = expectedRuntimePairs(identity.resolvedByProfileId);
  const existingRows = await ctx.db
    .query('townRelationships')
    .withIndex('world', (q) => q.eq('worldId', worldId))
    .collect();
  const seenPairs = new Set<string>();
  for (const row of existingRows) {
    if (row.residentA >= row.residentB) {
      throw new Error(`Town relationship pair is not sorted: ${row.residentA}:${row.residentB}`);
    }
    const pairKey = `${row.residentA}\u0000${row.residentB}`;
    if (seenPairs.has(pairKey)) throw new Error(`Duplicate town relationship pair: ${pairKey}`);
    seenPairs.add(pairKey);
    const expected = expectedByPair.get(pairKey);
    if (!expected) throw new Error(`Town relationship runtime mapping mismatch: ${pairKey}`);
    const migrated = await migrateLegacyRelationship(ctx, row, expected);
    validateRelationship(migrated, expected);
  }

  for (const expected of expectedByPair.values()) {
    const pairKey = `${expected.residentA}\u0000${expected.residentB}`;
    if (seenPairs.has(pairKey)) continue;
    await ctx.db.insert('townRelationships', {
      worldId,
      residentA: expected.residentA,
      residentB: expected.residentB,
      friendship: expected.friendship,
      trust: expected.trust,
      attraction: expected.attraction,
      business: expected.business,
      initialFriendship: expected.friendship,
      initialTrust: expected.trust,
      initialAttraction: expected.attraction,
      initialBusiness: expected.business,
      initializationSourceKey: expected.initializationSourceKey,
      initializedAt: now,
      updatedAt: now,
    });
    seenPairs.add(pairKey);
  }
  return {
    relationshipCount: seenPairs.size,
    residentCount: identity.resolvedByProfileId.size,
    missingResidentNames: identity.missingResidentNames,
    conflictingResidentNames: identity.conflictingResidentNames,
  };
}

export async function reconcileTownRelationsAfterAgentCreation(
  ctx: ReconciliationContext,
  args: { worldId: Id<'worlds'>; attempt: number; now?: number },
) {
  if (!Number.isSafeInteger(args.attempt) || args.attempt < 0) {
    throw new Error('Relationship reconciliation attempt must be a nonnegative safe integer');
  }
  const status = await worldStatus(ctx, args.worldId);
  if (!status || status.status !== 'running') return { status: 'world-not-running' as const };
  const initialized = await initializeTownRelations(ctx, args.worldId, args.now ?? Date.now());
  if (initialized.conflictingResidentNames.length > 0) {
    return { status: 'identity-conflict' as const, ...initialized };
  }
  if (initialized.residentCount === residentLifeProfiles.length) {
    return { status: 'complete' as const, ...initialized };
  }
  if (args.attempt >= MAX_RECONCILIATION_ATTEMPTS) {
    return { status: 'exhausted' as const, ...initialized };
  }
  const nextAttempt = args.attempt + 1;
  await ctx.scheduler.runAfter(
    Math.min(30_000, 10_000 * 2 ** args.attempt),
    internal.init.reconcileTownRelations,
    { worldId: args.worldId, attempt: nextAttempt },
  );
  return { status: 'retrying' as const, nextAttempt, ...initialized };
}

export async function recordRelationEvent(ctx: RelationContext, event: RelationEvent) {
  return recordRelationEventForStatus(ctx, event, 'running');
}

export async function recordInactiveRelationEvent(
  ctx: RelationContext,
  event: RelationEvent,
) {
  return recordRelationEventForStatus(ctx, event, 'inactive');
}

async function recordRelationEventForStatus(
  ctx: RelationContext,
  event: RelationEvent,
  requiredStatus: 'running' | 'inactive',
) {
  validateEvent(event);
  const status = await worldStatus(ctx, event.worldId);
  if (!status || status.status !== requiredStatus) {
    return relationResult('world-not-running', ZERO);
  }
  const [residentA, residentB] = sortedPair(event.residentA, event.residentB);
  const dayKey = shanghaiRelationDayKey(event.createdAt);
  const existing = await ctx.db
    .query('relationshipChanges')
    .withIndex('idempotencyKey', (q) =>
      q.eq('worldId', event.worldId).eq('idempotencyKey', event.idempotencyKey),
    )
    .unique();
  if (existing) {
    validatePersistedChange(existing);
    if (!sameEventFact(existing, event, residentA, residentB, dayKey)) {
      throw new Error(`relationship idempotency collision: ${event.idempotencyKey}`);
    }
    return relationResult('already-recorded', storedDeltas(existing));
  }

  await initializeTownRelations(ctx, event.worldId, event.createdAt);
  const relationship = await ctx.db
    .query('townRelationships')
    .withIndex('pair', (q) =>
      q.eq('worldId', event.worldId).eq('residentA', residentA).eq('residentB', residentB),
    )
    .unique();
  if (!relationship)
    throw new Error('Relationship event participants are not configured AI residents');
  const today = await ctx.db
    .query('relationshipChanges')
    .withIndex('pairDay', (q) =>
      q
        .eq('worldId', event.worldId)
        .eq('residentA', residentA)
        .eq('residentB', residentB)
        .eq('dayKey', dayKey),
    )
    .collect();
  for (const change of today) validatePersistedChange(change);
  const requested = requestedDeltas(event);
  const capped = capDeltas(
    requested,
    DAILY_CAPS[event.kind],
    today.filter((change) => change.kind === event.kind),
  );
  const applied = clampDeltas(relationship, capped);
  await ctx.db.insert('relationshipChanges', {
    worldId: event.worldId,
    idempotencyKey: event.idempotencyKey,
    residentA,
    residentB,
    kind: event.kind,
    ...(event.reciprocal !== undefined ? { reciprocal: event.reciprocal } : {}),
    friendshipDelta: applied.friendship,
    trustDelta: applied.trust,
    attractionDelta: applied.attraction,
    businessDelta: applied.business,
    dayKey,
    sourceKey: event.sourceKey,
    text: event.text,
    createdAt: event.createdAt,
  });
  await ctx.db.patch(relationship._id, {
    friendship: relationship.friendship + applied.friendship,
    trust: relationship.trust + applied.trust,
    attraction: relationship.attraction + applied.attraction,
    business: relationship.business + applied.business,
    updatedAt: Math.max(relationship.updatedAt, event.createdAt),
  });
  return relationResult('recorded', applied);
}

export async function recordCompletedConversationContact(
  ctx: RelationContext,
  args: { worldId: Id<'worlds'>; conversationId: string },
) {
  const archived = await ctx.db
    .query('archivedConversations')
    .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('id', args.conversationId))
    .first();
  if (
    !archived ||
    archived.ended < archived.created ||
    archived.numMessages < 1 ||
    archived.participants.length !== 2 ||
    archived.participants[0] === archived.participants[1]
  )
    return { status: 'not-completed' as const };
  const world = await ctx.db.get(args.worldId);
  if (!world) return { status: 'not-completed' as const };
  const descriptions = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
    .collect();
  const identity = resolveRuntimeResidentIdentity(world, descriptions);
  const residentIds = new Set(
    [...identity.resolvedByProfileId.values()].map((description) => description.playerId),
  );
  if (!archived.participants.every((participant) => residentIds.has(participant))) {
    return { status: 'excluded-participants' as const };
  }
  return recordRelationEvent(ctx, {
    worldId: args.worldId,
    idempotencyKey: `conversation:${args.worldId}:${args.conversationId}:pair`,
    residentA: archived.participants[0],
    residentB: archived.participants[1],
    kind: 'conversation',
    sourceKey: `conversation:${args.conversationId}`,
    text: `完成会话 ${args.conversationId}，实际参与者为 ${archived.participants.join(' 与 ')}。`,
    createdAt: archived.ended,
  });
}

export async function recordInstitutionPurchaseTrade(
  ctx: RelationContext,
  args: {
    worldId: Id<'worlds'>;
    buyerResidentId: string;
    institutionId: string;
    item: string;
    quantity: number;
    economyIdempotencyKey: string;
    economySourceKey: string;
    createdAt: number;
  },
) {
  if (!Number.isSafeInteger(args.quantity) || args.quantity <= 0) {
    throw new Error('Relationship trade quantity must be a positive safe integer');
  }
  const ownerProfiles = residentEconomyProfiles.filter(
    (candidate) =>
      candidate.institutionId === args.institutionId &&
      candidate.compensation.kind === 'owner-draw',
  );
  if (ownerProfiles.length !== 1) return { status: 'no-unique-owner' as const };
  const [buyer, owner] = await Promise.all([
    ctx.db
      .query('residentEconomy')
      .withIndex('resident', (q) =>
        q.eq('worldId', args.worldId).eq('residentId', args.buyerResidentId),
      )
      .unique(),
    ctx.db
      .query('residentEconomy')
      .withIndex('profile', (q) =>
        q.eq('worldId', args.worldId).eq('profileId', ownerProfiles[0].id),
      )
      .unique(),
  ]);
  if (!buyer || !owner) return { status: 'resident-account-missing' as const };
  if (buyer.residentId === owner.residentId) return { status: 'same-resident' as const };
  return recordRelationEvent(ctx, {
    worldId: args.worldId,
    idempotencyKey: `relation:${args.economyIdempotencyKey}:trade`,
    residentA: buyer.residentId,
    residentB: owner.residentId,
    kind: 'trade',
    sourceKey: args.economySourceKey,
    text: `${buyer.residentId} 在 ${args.institutionId} 实际购买 ${args.item} × ${args.quantity}，经营者为 ${owner.residentId}。`,
    createdAt: args.createdAt,
  });
}

export const recordStructuredRelationEvent = internalMutation({
  args: {
    worldId: v.id('worlds'),
    idempotencyKey: v.string(),
    residentA: v.string(),
    residentB: v.string(),
    kind: v.union(
      v.literal('conversation'),
      v.literal('cooperation'),
      v.literal('trade'),
      v.literal('care'),
      v.literal('reciprocal-affection'),
      v.literal('dispute'),
    ),
    reciprocal: v.optional(v.boolean()),
    sourceKey: v.string(),
    text: v.string(),
    createdAt: v.number(),
  },
  handler: recordRelationEvent,
});

export const recordConversationContact = internalMutation({
  args: { worldId: v.id('worlds'), conversationId: v.string() },
  handler: recordCompletedConversationContact,
});

export const initializeForWorld = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: (ctx, args) => initializeTownRelations(ctx, args.worldId),
});

function requestedDeltas(event: RelationEvent): Dimensions {
  if (event.kind === 'reciprocal-affection') {
    return event.reciprocal === true
      ? { friendship: 0, trust: 0, attraction: 1, business: 0 }
      : ZERO;
  }
  return EVENT_DELTAS[event.kind];
}

function capDeltas(
  requested: Dimensions,
  caps: Dimensions,
  prior: Array<{
    friendshipDelta: number;
    trustDelta: number;
    attractionDelta: number;
    businessDelta: number;
  }>,
): Dimensions {
  const sum = {
    friendship: prior.reduce((value, row) => value + row.friendshipDelta, 0),
    trust: prior.reduce((value, row) => value + row.trustDelta, 0),
    attraction: prior.reduce((value, row) => value + row.attractionDelta, 0),
    business: prior.reduce((value, row) => value + row.businessDelta, 0),
  };
  return Object.fromEntries(
    (Object.keys(ZERO) as Array<keyof Dimensions>).map((dimension) => {
      const delta = requested[dimension];
      const cap = caps[dimension];
      const remaining =
        cap >= 0 ? Math.max(0, cap - sum[dimension]) : Math.min(0, cap - sum[dimension]);
      return [dimension, delta >= 0 ? Math.min(delta, remaining) : Math.max(delta, remaining)];
    }),
  ) as Dimensions;
}

function clampDeltas(current: Dimensions, deltas: Dimensions): Dimensions {
  return Object.fromEntries(
    (Object.keys(ZERO) as Array<keyof Dimensions>).map((dimension) => {
      const next = Math.min(100, Math.max(0, current[dimension] + deltas[dimension]));
      return [dimension, next - current[dimension]];
    }),
  ) as Dimensions;
}

function storedDeltas(row: {
  friendshipDelta: number;
  trustDelta: number;
  attractionDelta: number;
  businessDelta: number;
}): Dimensions {
  return {
    friendship: row.friendshipDelta,
    trust: row.trustDelta,
    attraction: row.attractionDelta,
    business: row.businessDelta,
  };
}

function relationResult<T extends string>(status: T, deltas: Dimensions) {
  return { status, deltas: { ...deltas } };
}

function sameEventFact(
  row: {
    residentA: string;
    residentB: string;
    kind: string;
    reciprocal?: boolean;
    dayKey: string;
    sourceKey: string;
    text: string;
    createdAt: number;
  },
  event: RelationEvent,
  residentA: string,
  residentB: string,
  dayKey: string,
) {
  return (
    row.residentA === residentA &&
    row.residentB === residentB &&
    row.kind === event.kind &&
    row.reciprocal === event.reciprocal &&
    row.dayKey === dayKey &&
    row.sourceKey === event.sourceKey &&
    row.text === event.text &&
    row.createdAt === event.createdAt
  );
}

function sortedPair(a: string, b: string): [string, string] {
  if (a === b) throw new Error('Relationship event requires two different residents');
  return a < b ? [a, b] : [b, a];
}

function validateEvent(event: RelationEvent) {
  sortedPair(event.residentA, event.residentB);
  assertBoundedKey(event.idempotencyKey, 'idempotencyKey');
  assertBoundedKey(event.sourceKey, 'sourceKey');
  if (!event.text || event.text.length > MAX_TEXT_LENGTH)
    throw new Error('Invalid relationship text');
  assertTimestamp(event.createdAt, 'createdAt');
  if (event.kind === 'reciprocal-affection') {
    if (typeof event.reciprocal !== 'boolean') {
      throw new Error('reciprocal-affection requires structured reciprocal evidence');
    }
  } else if (event.reciprocal !== undefined) {
    throw new Error(`${event.kind} cannot carry reciprocal evidence`);
  }
}

function validatePersistedChange(row: {
  idempotencyKey: string;
  residentA: string;
  residentB: string;
  kind: string;
  reciprocal?: boolean;
  friendshipDelta: number;
  trustDelta: number;
  attractionDelta: number;
  businessDelta: number;
  dayKey: string;
  sourceKey: string;
  text: string;
  createdAt: number;
}) {
  try {
    if (row.residentA >= row.residentB) throw new Error('unsorted pair');
    assertBoundedKey(row.idempotencyKey, 'idempotencyKey');
    assertBoundedKey(row.sourceKey, 'sourceKey');
    if (!row.text || row.text.length > MAX_TEXT_LENGTH) throw new Error('invalid text');
    assertTimestamp(row.createdAt, 'createdAt');
    if (row.dayKey !== shanghaiRelationDayKey(row.createdAt)) throw new Error('day mismatch');
    if (
      !['conversation', 'cooperation', 'trade', 'care', 'reciprocal-affection', 'dispute'].includes(
        row.kind,
      )
    )
      throw new Error('invalid kind');
    const fact = {
      worldId: '' as Id<'worlds'>,
      idempotencyKey: row.idempotencyKey,
      residentA: row.residentA,
      residentB: row.residentB,
      kind: row.kind as RelationEventKind,
      ...(row.reciprocal !== undefined ? { reciprocal: row.reciprocal } : {}),
      sourceKey: row.sourceKey,
      text: row.text,
      createdAt: row.createdAt,
    };
    if (fact.kind === 'reciprocal-affection') {
      if (typeof fact.reciprocal !== 'boolean') throw new Error('missing reciprocal evidence');
    } else if (fact.reciprocal !== undefined) {
      throw new Error('unexpected reciprocal evidence');
    }
    const requested = requestedDeltas(fact);
    const actual = storedDeltas(row);
    for (const dimension of Object.keys(ZERO) as Array<keyof Dimensions>) {
      const delta = actual[dimension];
      if (!Number.isSafeInteger(delta) || delta < -100 || delta > 100) {
        throw new Error('invalid delta bound');
      }
      const maximum = requested[dimension];
      if (maximum >= 0 ? delta < 0 || delta > maximum : delta > 0 || delta < maximum) {
        throw new Error('delta contradicts event kind');
      }
    }
  } catch (error) {
    throw new Error(`Invalid persisted relationship change: ${row.idempotencyKey}`, {
      cause: error,
    });
  }
}

function assertBoundedKey(value: string, label: string) {
  if (!value || value.length > MAX_KEY_LENGTH || !KEY.test(value)) {
    throw new Error(`Invalid relationship ${label}`);
  }
}

function assertTimestamp(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) {
    throw new Error(`Invalid relationship ${label}`);
  }
}

function assertDimension(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new Error(`Invalid relationship dimension ${label}`);
  }
}

async function worldStatus(ctx: RelationContext, worldId: Id<'worlds'>) {
  return ctx.db
    .query('worldStatus')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .unique();
}

function resolveRuntimeResidentIdentity(
  world: {
    players: Array<{ id: string; human?: string }>;
    agents: Array<{ playerId: string }>;
  },
  descriptions: Array<{ playerId: string; name: string }>,
) {
  const agentCounts = new Map<string, number>();
  for (const agent of world.agents) {
    agentCounts.set(agent.playerId, (agentCounts.get(agent.playerId) ?? 0) + 1);
  }
  const aiIds = new Set(
    world.players
      .filter((player) => player.human === undefined && agentCounts.get(player.id) === 1)
      .map((player) => player.id),
  );
  const candidates = new Map<string, typeof descriptions>();
  for (const description of descriptions) {
    if (!aiIds.has(description.playerId)) continue;
    const profile = residentLifeProfiles.find((entry) => entry.name === description.name);
    if (!profile) continue;
    const rows = candidates.get(profile.id) ?? [];
    rows.push(description);
    candidates.set(profile.id, rows);
  }
  const resolvedByProfileId = new Map<string, (typeof descriptions)[number]>();
  const conflicts = new Set<string>();
  const missing = new Set<string>();
  for (const profile of residentLifeProfiles) {
    const rows = candidates.get(profile.id) ?? [];
    if (rows.length === 0) missing.add(profile.name);
    else if (rows.length > 1) conflicts.add(profile.name);
    else resolvedByProfileId.set(profile.id, rows[0]);
  }
  const byPlayer = new Map<string, string[]>();
  for (const [profileId, description] of resolvedByProfileId) {
    const profileIds = byPlayer.get(description.playerId) ?? [];
    profileIds.push(profileId);
    byPlayer.set(description.playerId, profileIds);
  }
  for (const profileIds of byPlayer.values()) {
    if (profileIds.length < 2) continue;
    for (const profileId of profileIds) {
      conflicts.add(profile(profileId).name);
      resolvedByProfileId.delete(profileId);
    }
  }
  const ordered = (values: Set<string>) =>
    residentLifeProfiles.map((entry) => entry.name).filter((name) => values.has(name));
  return {
    resolvedByProfileId,
    missingResidentNames: ordered(missing),
    conflictingResidentNames: ordered(conflicts),
  };
}

function expectedRuntimePairs(resolved: ReadonlyMap<string, { playerId: string }>) {
  const result = new Map<
    string,
    ReturnType<typeof expectedPair> & {
      residentA: string;
      residentB: string;
    }
  >();
  const entries = [...resolved.entries()];
  for (let first = 0; first < entries.length; first += 1) {
    for (let second = first + 1; second < entries.length; second += 1) {
      const [profileA, residentA] = entries[first];
      const [profileB, residentB] = entries[second];
      const [runtimeA, runtimeB] = sortedPair(residentA.playerId, residentB.playerId);
      const expected = expectedPair(profileA, profileB);
      result.set(`${runtimeA}\u0000${runtimeB}`, {
        residentA: runtimeA,
        residentB: runtimeB,
        ...expected,
      });
    }
  }
  return result;
}

function expectedPair(profileA: string, profileB: string) {
  const [idA, idB] = profileA < profileB ? [profileA, profileB] : [profileB, profileA];
  const scores: Dimensions = { friendship: 40, trust: 40, attraction: 0, business: 20 };
  for (const [sourceId, targetId] of [
    [profileA, profileB],
    [profileB, profileA],
  ]) {
    const relation = profile(sourceId).relationships.filter((entry) => entry.targetId === targetId);
    for (const entry of relation) {
      const dimension =
        entry.kind === 'friendship'
          ? 'friendship'
          : entry.kind === 'business'
            ? 'business'
            : 'attraction';
      scores[dimension] = Math.max(scores[dimension], entry.score);
    }
  }
  return {
    ...scores,
    initializationSourceKey: `lives-definition:pair:${idA}:${idB}:v1`,
  };
}

function profile(profileId: string) {
  const value = residentLifeProfiles.find((entry) => entry.id === profileId);
  if (!value) throw new Error(`Unknown resident profile: ${profileId}`);
  return value;
}

async function migrateLegacyRelationship<
  T extends {
    _id: Id<'townRelationships'>;
    _creationTime: number;
    initialFriendship?: number;
    initialTrust?: number;
    initialAttraction?: number;
    initialBusiness?: number;
    initializationSourceKey?: string;
    initializedAt?: number;
  },
>(ctx: RelationContext, row: T, expected: ReturnType<typeof expectedPair>) {
  const patch = {
    ...(row.initialFriendship === undefined ? { initialFriendship: expected.friendship } : {}),
    ...(row.initialTrust === undefined ? { initialTrust: expected.trust } : {}),
    ...(row.initialAttraction === undefined ? { initialAttraction: expected.attraction } : {}),
    ...(row.initialBusiness === undefined ? { initialBusiness: expected.business } : {}),
    ...(row.initializationSourceKey === undefined
      ? { initializationSourceKey: expected.initializationSourceKey }
      : {}),
    ...(row.initializedAt === undefined ? { initializedAt: row._creationTime } : {}),
  };
  if (Object.keys(patch).length > 0) await ctx.db.patch(row._id, patch);
  return { ...row, ...patch } as Omit<
    T,
    | 'initialFriendship'
    | 'initialTrust'
    | 'initialAttraction'
    | 'initialBusiness'
    | 'initializationSourceKey'
    | 'initializedAt'
  > & {
    initialFriendship: number;
    initialTrust: number;
    initialAttraction: number;
    initialBusiness: number;
    initializationSourceKey: string;
    initializedAt: number;
  };
}

function validateRelationship(
  row: {
    friendship: number;
    trust: number;
    attraction: number;
    business: number;
    initialFriendship: number;
    initialTrust: number;
    initialAttraction: number;
    initialBusiness: number;
    initializationSourceKey: string;
    initializedAt: number;
    updatedAt: number;
  },
  expected: ReturnType<typeof expectedPair>,
) {
  for (const dimension of Object.keys(ZERO) as Array<keyof Dimensions>) {
    assertDimension(row[dimension], dimension);
    const initialKey = `initial${dimension[0].toUpperCase()}${dimension.slice(1)}` as
      | 'initialFriendship'
      | 'initialTrust'
      | 'initialAttraction'
      | 'initialBusiness';
    assertDimension(row[initialKey], initialKey);
    if (row[initialKey] !== expected[dimension]) {
      throw new Error(`Town relationship initial ${dimension} mismatch`);
    }
  }
  if (row.initializationSourceKey !== expected.initializationSourceKey) {
    throw new Error('Town relationship initialization source mismatch');
  }
  assertTimestamp(row.initializedAt, 'initializedAt');
  assertTimestamp(row.updatedAt, 'updatedAt');
  if (row.updatedAt < row.initializedAt)
    throw new Error('Relationship updatedAt precedes initialization');
}
