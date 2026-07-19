import { v } from 'convex/values';
import {
  goods,
  institutions,
  residentEconomyProfiles,
  services as townServices,
  type GoodId,
  type InstitutionDefinition,
  type ResidentEconomyProfile,
} from '../data/worlds/lighthouse-town/economy';
import {
  type EconomicAction,
  type ResidentActivity,
} from '../data/worlds/lighthouse-town/activities';
import {
  townLandmarkById,
  townLandmarks,
  mapheight,
  mapwidth,
  tiledim,
  tilesetpath,
  type TownLandmarkId,
} from '../data/worlds/lighthouse-town/map';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { MAX_MONEY, MAX_STOCK } from './townEconomyRules';
import { settlePurchase, settleWork } from './townEconomyRules';
import { distance } from './util/geometry';
import { recordInstitutionPurchaseTrade } from './townRelations';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
// The final millisecond that still formats as a four-digit Shanghai calendar year.
const MAX_SHANGHAI_TIMESTAMP = Date.parse('9999-12-31T15:59:59.999Z');
const STARTING_INSTITUTION_CASH = 120;
const DAILY_INSTITUTION_OPERATING_COST = 2;
const DAILY_ECONOMY_WORLD_PAGE_SIZE = 32;
const MAX_LEDGER_KEY_LENGTH = 160;
const MAX_LEDGER_TEXT_LENGTH = 500;
const CANONICAL_KEY = /^[a-z0-9][a-z0-9:._-]*$/u;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/u;
const INITIAL_STOCK: Readonly<Record<GoodId, number>> = {
  meal: 12,
  tea: 12,
  medicine: 8,
  'daily-goods': 10,
  'craft-service': 99,
};

export const MAX_ECONOMY_RECONCILIATION_ATTEMPTS = 5;

export type EconomyLedgerKind =
  | 'work'
  | 'purchase'
  | 'restock'
  | 'event-reward'
  | 'event-service';

type EconomyLedgerBase = {
  worldId: Id<'worlds'>;
  idempotencyKey: string;
  dayKey: string;
  amount: number;
  sourceKey: string;
  text: string;
  createdAt: number;
};
type CompensationKind = ResidentEconomyProfile['compensation']['kind'];

export type EconomyLedgerEntry = EconomyLedgerBase & (
  | { kind: 'work'; residentId: string; institutionId: string; expectedAmount: number; compensationKind: CompensationKind; item: string; quantity: number }
  | { kind: 'purchase'; residentId: string; institutionId: string; expectedAmount?: never; item: string; quantity: number }
  | { kind: 'restock'; residentId?: never; institutionId: string; expectedAmount?: never; item: string; quantity: number }
  | { kind: 'event-reward'; residentId: string; institutionId?: never; expectedAmount?: never; item?: never; quantity?: never }
  | { kind: 'event-service'; residentId: string; institutionId: string; expectedAmount?: never; item: string; quantity: number }
);

type EconomyDbContext = Pick<MutationCtx, 'db'>;
type EconomyReconciliationContext = Pick<MutationCtx, 'db' | 'scheduler'>;

export function shanghaiEconomyDayKey(timestamp: number): string {
  assertDateTimestamp(timestamp, 'createdAt');
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export async function initializeTownEconomy(
  ctx: EconomyDbContext,
  worldId: Id<'worlds'>,
  now = Date.now(),
) {
  assertDateTimestamp(now, 'updatedAt');
  assertBoundedSafeInteger(STARTING_INSTITUTION_CASH, MAX_MONEY, 'institution.cash');
  const dayKey = shanghaiEconomyDayKey(now);
  const world = await ctx.db.get(worldId);
  if (!world) throw new Error('Town economy runtime world is missing');

  const runtimeDescriptions = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .collect();
  const identity = resolveRuntimeResidentIdentity(world, runtimeDescriptions);

  const existingAccounts = await ctx.db
    .query('residentEconomy')
    .withIndex('world', (q) => q.eq('worldId', worldId))
    .collect();
  const accountResidentIds = new Set<string>();
  const accountProfileIds = new Set<string>();
  for (const row of existingAccounts) {
    const migrated = await migrateLegacyResident(ctx, row);
    validatePersistedResident(migrated, identity.resolvedByProfileId);
    if (accountProfileIds.has(row.profileId)) {
      throw new Error(`Duplicate resident economy profile: ${row.profileId}`);
    }
    if (accountResidentIds.has(row.residentId)) {
      throw new Error(`Duplicate resident economy runtime mapping: ${row.residentId}`);
    }
    accountResidentIds.add(row.residentId);
    accountProfileIds.add(row.profileId);
  }

  for (const profile of residentEconomyProfiles) {
    const runtimeDescription = identity.resolvedByProfileId.get(profile.id);
    if (!runtimeDescription) continue;
    if (
      accountResidentIds.has(runtimeDescription.playerId)
      || accountProfileIds.has(profile.id)
    ) continue;
    assertBoundedSafeInteger(
      profile.startingBalance,
      MAX_MONEY,
      `${profile.id}.startingBalance`,
    );
    await ctx.db.insert('residentEconomy', {
      worldId,
      residentId: runtimeDescription.playerId,
      profileId: profile.id,
      balance: profile.startingBalance,
      initialBalance: profile.startingBalance,
      hunger: 100,
      energy: 100,
      todayIncome: 0,
      todayExpense: 0,
      dayKey,
      initializationSourceKey: residentInitializationSource(profile.id),
      initializedAt: now,
      updatedAt: now,
    });
    accountResidentIds.add(runtimeDescription.playerId);
    accountProfileIds.add(profile.id);
  }

  const existingInstitutions = await ctx.db
    .query('townInstitutions')
    .withIndex('world', (q) => q.eq('worldId', worldId))
    .collect();
  const institutionIds = new Set<string>();
  for (const row of existingInstitutions) {
    const migrated = await migrateLegacyInstitution(ctx, row);
    validatePersistedInstitution(migrated);
    if (institutionIds.has(row.institutionId)) {
      throw new Error(`Duplicate town institution: ${row.institutionId}`);
    }
    institutionIds.add(row.institutionId);
  }
  for (const institution of institutions) {
    if (institutionIds.has(institution.id)) continue;
    const stock = initialStock(institution);
    const serviceCounters = initialServiceCounters(institution);
    const stockJson = JSON.stringify(stock);
    const serviceCountersJson = JSON.stringify(serviceCounters);
    await ctx.db.insert('townInstitutions', {
      worldId,
      institutionId: institution.id,
      cash: STARTING_INSTITUTION_CASH,
      initialCash: STARTING_INSTITUTION_CASH,
      stockJson,
      initialStockJson: stockJson,
      serviceCountersJson,
      initialServiceCountersJson: serviceCountersJson,
      todayIncome: 0,
      todayExpense: 0,
      visitorCount: 0,
      dayKey,
      initializationSourceKey: institutionInitializationSource(institution.id),
      initializedAt: now,
      updatedAt: now,
    });
    institutionIds.add(institution.id);
  }

  return {
    residentCount: accountProfileIds.size,
    institutionCount: institutionIds.size,
    missingResidentNames: identity.missingResidentNames,
    conflictingResidentNames: identity.conflictingResidentNames,
  };
}

export async function advanceDailyEconomy(
  ctx: EconomyDbContext,
  now = Date.now(),
) {
  assertDateTimestamp(now, 'daily economy timestamp');
  const worldStatuses = await ctx.db.query('worldStatus').collect();
  let advancedWorlds = 0;
  let advancedInstitutions = 0;
  for (const worldStatus of worldStatuses) {
    if (worldStatus.status !== 'running') continue;
    await initializeTownEconomy(ctx, worldStatus.worldId, now);
    if (await ensureDailyEconomyAdvanced(ctx, worldStatus.worldId, now)) {
      advancedWorlds += 1;
      advancedInstitutions += institutions.length;
    }
  }
  return { advancedWorlds, advancedInstitutions };
}

export async function dispatchDailyEconomyPage(
  ctx: EconomyReconciliationContext,
  args: { cursor: string | null; now: number },
) {
  assertDateTimestamp(args.now, 'daily economy timestamp');
  const page = await ctx.db
    .query('worldStatus')
    .paginate({ cursor: args.cursor, numItems: DAILY_ECONOMY_WORLD_PAGE_SIZE });
  let scheduledWorlds = 0;
  for (const worldStatus of page.page) {
    if (worldStatus.status !== 'running') continue;
    await ctx.scheduler.runAfter(0, internal.townEconomy.advanceDailyEconomyForWorld, {
      worldId: worldStatus.worldId,
      now: args.now,
    });
    scheduledWorlds += 1;
  }
  if (!page.isDone) {
    await ctx.scheduler.runAfter(0, internal.townEconomy.advanceDailyEconomyTick, {
      cursor: page.continueCursor,
      now: args.now,
    });
  }
  return { scheduledWorlds, done: page.isDone };
}

export async function advanceDailyEconomyForWorldNow(
  ctx: EconomyDbContext,
  args: { worldId: Id<'worlds'>; now: number },
) {
  assertDateTimestamp(args.now, 'daily economy timestamp');
  const worldStatus = await ctx.db
    .query('worldStatus')
    .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
    .unique();
  if (!worldStatus || worldStatus.status !== 'running') {
    return { status: 'world-not-running' as const, advancedInstitutions: 0 };
  }
  const requestedDayKey = shanghaiEconomyDayKey(args.now);
  const latestMarker = await latestDailyEconomyMarker(ctx, args.worldId);
  if (latestMarker && latestMarker.dayKey > requestedDayKey) {
    return { status: 'stale' as const, advancedInstitutions: 0 };
  }
  await initializeTownEconomy(ctx, args.worldId, args.now);
  const advanced = await ensureDailyEconomyAdvanced(ctx, args.worldId, args.now);
  return {
    status: advanced ? 'advanced' as const : 'already-advanced' as const,
    advancedInstitutions: advanced ? institutions.length : 0,
  };
}

export async function ensureDailyEconomyAdvanced(
  ctx: EconomyDbContext,
  worldId: Id<'worlds'>,
  now: number,
) {
  assertDateTimestamp(now, 'daily economy timestamp');
  const dayKey = shanghaiEconomyDayKey(now);
  const marker = await ctx.db
    .query('dailyEconomyDays')
    .withIndex('worldDay', (q) => q.eq('worldId', worldId).eq('dayKey', dayKey))
    .unique();
  if (marker) return false;
  const latestMarker = await latestDailyEconomyMarker(ctx, worldId);
  if (latestMarker && latestMarker.dayKey > dayKey) return false;
  const [accounts, institutionRows] = await Promise.all([
    ctx.db
      .query('residentEconomy')
      .withIndex('world', (q) => q.eq('worldId', worldId))
      .collect(),
    ctx.db
      .query('townInstitutions')
      .withIndex('world', (q) => q.eq('worldId', worldId))
      .collect(),
  ]);
  if (institutionRows.length !== institutions.length) {
    throw new Error('Daily economy requires every configured institution');
  }
  for (const account of accounts) {
    await ctx.db.patch(account._id, {
      todayIncome: 0,
      todayExpense: 0,
      dayKey,
      updatedAt: now,
    });
  }
  for (const institution of institutionRows) {
    const definition = institutionDefinition(institution.institutionId);
    const stock = parseCounterJson(institution.stockJson);
    const configuredStock = initialStock(definition);
    const restocked: Record<string, number> = {};
    let quantity = 0;
    for (const goodId of definition.goods) {
      const current = stock[goodId] ?? 0;
      const cap = configuredStock[goodId] ?? 0;
      const added = Math.max(0, cap - current);
      if (added > 0) {
        stock[goodId] = cap;
        restocked[goodId] = added;
        quantity += added;
      }
    }
    assertBoundedSafeInteger(quantity, MAX_STOCK, `${definition.id}.dailyRestock`);
    const operatingCost = Math.min(DAILY_INSTITUTION_OPERATING_COST, institution.cash);
    assertBoundedSafeInteger(operatingCost, DAILY_INSTITUTION_OPERATING_COST, 'operating cost');
    await ctx.db.patch(institution._id, {
      cash: institution.cash - operatingCost,
      stockJson: JSON.stringify(stock),
      todayIncome: 0,
      todayExpense: operatingCost,
      visitorCount: 0,
      dayKey,
      updatedAt: now,
    });
    const item = JSON.stringify(restocked);
    await appendEconomyLedger(ctx, {
      worldId,
      idempotencyKey: `daily:${dayKey}:restock:${definition.id}`,
      dayKey,
      institutionId: definition.id,
      kind: 'restock',
      amount: operatingCost,
      item,
      quantity,
      sourceKey: `daily:${dayKey}:restock:${definition.id}`,
      text: `${definition.name}实际支出 ${operatingCost} 金贝运营成本，按配置补充 ${quantity} 件商品库存。`,
      createdAt: now,
    });
  }
  await ctx.db.insert('dailyEconomyDays', { worldId, dayKey, advancedAt: now });
  return true;
}

async function latestDailyEconomyMarker(
  ctx: EconomyDbContext,
  worldId: Id<'worlds'>,
) {
  return ctx.db
    .query('dailyEconomyDays')
    .withIndex('worldDay', (q) => q.eq('worldId', worldId))
    .order('desc')
    .first();
}

export const advanceDailyEconomyTick = internalMutation({
  args: { cursor: v.optional(v.string()), now: v.optional(v.number()) },
  handler: (ctx, args) => dispatchDailyEconomyPage(ctx, {
    cursor: args.cursor ?? null,
    now: args.now ?? Date.now(),
  }),
});

export const advanceDailyEconomyForWorld = internalMutation({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: (ctx, args) => advanceDailyEconomyForWorldNow(ctx, args),
});

export const residentEconomyState = internalQuery({
  args: { worldId: v.id('worlds'), residentId: v.string() },
  handler: async (ctx, args) => {
    const status = await ctx.db
      .query('worldStatus')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .unique();
    if (!status || status.status !== 'running') return null;
    const account = await ctx.db
      .query('residentEconomy')
      .withIndex('resident', (q) =>
        q.eq('worldId', args.worldId).eq('residentId', args.residentId),
      )
      .unique();
    if (!account) return null;
    const institutionRows = await ctx.db
      .query('townInstitutions')
      .withIndex('world', (q) => q.eq('worldId', args.worldId))
      .collect();
    return {
      hunger: account.hunger,
      energy: account.energy,
      balance: account.balance,
      institutions: institutionRows.map((institution) => ({
        institutionId: institution.institutionId,
        cash: institution.cash,
        stock: parseCounterJson(institution.stockJson),
        serviceCounters: parseCounterJson(institution.serviceCountersJson),
        open: true,
      })),
    };
  },
});

export const institutionDetails = query({
  args: { worldId: v.id('worlds'), institutionId: v.string() },
  handler: readInstitutionDetails,
});

export async function readInstitutionDetails(
  ctx: Pick<QueryCtx, 'db'>,
  args: { worldId: Id<'worlds'>; institutionId: string },
) {
    const definition = institutions.find((candidate) => candidate.id === args.institutionId);
    if (!definition) return null;
    const [world, worldStatus, worldMap] = await Promise.all([
      ctx.db.get(args.worldId),
      ctx.db
        .query('worldStatus')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
        .unique(),
      ctx.db
        .query('maps')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
        .unique(),
    ]);
    if (!world || !worldStatus) return unavailableInstitution('missing', 'world-missing');
    const worldRuntimeStatus = worldStatus.status === 'running' ? 'running' as const : 'paused' as const;
    if (
      !worldMap
      || worldMap.tileSetUrl !== tilesetpath
      || worldMap.width !== mapwidth
      || worldMap.height !== mapheight
      || worldMap.tileDim !== tiledim
    ) {
      return unavailableInstitution(worldRuntimeStatus, 'foreign-world-map');
    }
    const landmark = townLandmarkById(definition.landmarkId as TownLandmarkId);
    const runtime = await ctx.db
      .query('townInstitutions')
      .withIndex('institution', (q) =>
        q.eq('worldId', args.worldId).eq('institutionId', args.institutionId),
      )
      .unique();
    const recentLedger = runtime
      ? await ctx.db
          .query('economyLedger')
          .withIndex('institutionTime', (q) =>
            q.eq('worldId', args.worldId).eq('institutionId', args.institutionId),
          )
          .order('desc')
          .take(8)
      : [];
    const stock = runtime ? parseCounterJson(runtime.stockJson) : {};
    const serviceCounters = runtime ? parseCounterJson(runtime.serviceCountersJson) : {};
    return {
      institutionStatus: 'available' as const,
      worldRuntimeStatus,
      snapshotStatus: worldRuntimeStatus === 'running' ? 'current' as const : 'paused' as const,
      institutionId: definition.id,
      name: definition.name,
      description: landmark.description,
      openHours: landmark.openHours,
      landmarkServices: landmark.services,
      ...(runtime
        ? { runtimeStatus: worldRuntimeStatus === 'running' ? 'live' as const : 'snapshot' as const }
        : { runtimeStatus: 'initializing' as const }),
      goods: definition.goods.map((goodId) => {
        const good = goods.find((candidate) => candidate.id === goodId)!;
        return { id: good.id, name: good.name, price: good.price, stock: runtime ? stock[goodId] ?? 0 : null };
      }),
      services: definition.serviceIds.map((serviceId) => {
        const service = townServices.find((candidate) => candidate.id === serviceId)!;
        return {
          id: service.id,
          name: service.name,
          counterName: service.counterName,
          completed: runtime ? serviceCounters[serviceId] ?? 0 : null,
        };
      }),
      stock: runtime ? stock : null,
      serviceCounters: runtime ? serviceCounters : null,
      cash: runtime?.cash ?? null,
      todayIncome: runtime?.todayIncome ?? null,
      todayExpense: runtime?.todayExpense ?? null,
      visitorCount: runtime?.visitorCount ?? null,
      dayKey: runtime?.dayKey ?? null,
      recentLedger: recentLedger.map((entry) => ({
        kind: entry.kind,
        text: entry.text,
        amount: entry.amount,
        item: entry.item,
        quantity: entry.quantity,
        residentId: entry.residentId,
        sourceKey: entry.sourceKey,
        createdAt: entry.createdAt,
      })),
    };
}

function unavailableInstitution(
  worldRuntimeStatus: 'running' | 'paused' | 'missing',
  unavailableReason: string,
) {
  return {
    institutionStatus: 'unavailable' as const,
    worldRuntimeStatus,
    snapshotStatus: 'unavailable' as const,
    unavailableReason,
  };
}

export async function reconcileTownEconomyAfterAgentCreation(
  ctx: EconomyReconciliationContext,
  args: { worldId: Id<'worlds'>; attempt: number; now?: number },
) {
  assertNonNegativeSafeInteger(args.attempt, 'reconciliation attempt');
  const status = await ctx.db
    .query('worldStatus')
    .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
    .unique();
  if (!status || status.status !== 'running') {
    return { status: 'world-not-running' as const };
  }
  const initialized = await initializeTownEconomy(ctx, args.worldId, args.now ?? Date.now());
  if (initialized.conflictingResidentNames.length > 0) {
    return { status: 'identity-conflict' as const, ...initialized };
  }
  if (initialized.residentCount === residentEconomyProfiles.length) {
    return { status: 'complete' as const, ...initialized };
  }
  if (args.attempt >= MAX_ECONOMY_RECONCILIATION_ATTEMPTS) {
    return { status: 'exhausted' as const, ...initialized };
  }
  const nextAttempt = args.attempt + 1;
  const delay = Math.min(30_000, 10_000 * 2 ** args.attempt);
  await ctx.scheduler.runAfter(delay, internal.init.reconcileTownEconomy, {
    worldId: args.worldId,
    attempt: nextAttempt,
  });
  return { status: 'retrying' as const, nextAttempt, ...initialized };
}

export async function appendEconomyLedger(
  ctx: EconomyDbContext,
  entry: EconomyLedgerEntry,
): Promise<boolean> {
  validateLedgerEntryShape(entry);
  const existing = await ctx.db
    .query('economyLedger')
    .withIndex('idempotencyKey', (q) =>
      q.eq('worldId', entry.worldId).eq('idempotencyKey', entry.idempotencyKey),
    )
    .unique();
  if (existing) {
    if (ledgerEntriesEquivalent(existing, entry)) return false;
    throw new Error(`idempotencyKey collision: ${entry.idempotencyKey}`);
  }
  await validateLedgerContract(ctx, entry);
  await ctx.db.insert('economyLedger', entry);
  return true;
}

export type ActivitySettlementArgs = {
  worldId: Id<'worlds'>;
  residentId: string;
  operationId: string;
  activityText: string;
  activityUntil: number;
  landmarkId: TownLandmarkId;
  category: ResidentActivity['category'];
  economicAction: EconomicAction;
  terminalFailureReason?: 'destination-not-reached';
  now?: number;
};

export type DailyEventHostService = Readonly<{
  residentId: string;
  institutionId: string;
  serviceId: string;
  amount: number;
  quantity: number;
}>;

export type DailyEventRewardSettlementArgs = Readonly<{
  worldId: Id<'worlds'>;
  eventId: Id<'townEvents'>;
  dayKey: string;
  hostServices: readonly DailyEventHostService[] | null;
  now: number;
}>;

const DAILY_EVENT_REWARD_TIERS = [
  { key: 'participation', amount: 10, label: '参与' },
  { key: 'finalist', amount: 20, label: '晋级' },
  { key: 'champion', amount: 50, label: '冠军' },
] as const;

/**
 * Settles the factual reward rows for one completed daily event. The caller is
 * expected to persist the event state in the same mutation and may call this
 * helper directly from that internal mutation.
 */
export async function settleDailyEventRewards(
  ctx: EconomyDbContext,
  args: DailyEventRewardSettlementArgs,
) {
  validateDailyEventRewardInput(args);
  const event = await ctx.db.get(args.eventId);
  if (!event) throw new Error('Daily event reward event is missing');
  if (event.worldId !== args.worldId) throw new Error('Daily event reward world mismatch');
  if (event.dailyKey === undefined) {
    throw new Error('Legacy event without dailyKey cannot settle daily rewards');
  }
  if (event.dailyKey !== args.dayKey) throw new Error('Daily event reward day mismatch');
  if (event.status !== 'completed') throw new Error('Daily event rewards require a completed event');

  const persistedParticipants = await ctx.db
    .query('eventParticipants')
    .withIndex('eventId', (q) => q.eq('eventId', args.eventId))
    .collect();
  const participants = validatePersistedDailyEventParticipants(
    persistedParticipants,
    event.winnerId,
  );
  const world = await ctx.db.get(args.worldId);
  if (!world) throw new Error('Daily event reward world is missing');

  const configuredProfiles = new Map(
    residentEconomyProfiles.map((profile) => [profile.id, profile]),
  );
  if (configuredProfiles.size !== 9) {
    throw new Error('Daily event rewards require exactly nine configured residents');
  }
  const seenProfiles = new Set<string>();
  const accountPlans: Array<{
    accountId: Id<'residentEconomy'>;
    profileId: string;
    balance: number;
    todayIncome: number;
    todayExpense: number;
  }> = [];
  const allEntries: EconomyLedgerEntry[] = [];

  for (const participant of participants) {
    const player = world.players.find((candidate) => candidate.id === participant.residentId);
    const activeAgents = world.agents.filter(
      (candidate) => candidate.playerId === participant.residentId,
    );
    if (!player || player.human !== undefined || activeAgents.length !== 1) {
      throw new Error(`Daily event resident is not one active AI: ${participant.residentId}`);
    }
    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) =>
        q.eq('worldId', args.worldId).eq('playerId', participant.residentId),
      )
      .take(2);
    if (
      playerDescriptions.length !== 1
      || playerDescriptions[0].name !== participant.displayName
    ) {
      throw new Error(`Daily event player description mismatch: ${participant.residentId}`);
    }
    const agentDescriptions = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) =>
        q.eq('worldId', args.worldId).eq('agentId', activeAgents[0].id),
      )
      .take(2);
    if (
      agentDescriptions.length !== 1
      || agentDescriptions[0].identity !== participant.identity
    ) {
      throw new Error(`Daily event agent identity mismatch: ${participant.residentId}`);
    }
    const account = await ctx.db
      .query('residentEconomy')
      .withIndex('resident', (q) =>
        q.eq('worldId', args.worldId).eq('residentId', participant.residentId),
      )
      .unique();
    if (!account) {
      throw new Error(`Daily event resident account is missing: ${participant.residentId}`);
    }
    const profile = configuredProfiles.get(account.profileId);
    if (
      !profile
      || profile.name !== participant.displayName
      || playerDescriptions[0].name !== profile.name
    ) {
      throw new Error(`Daily event resident is not configured: ${participant.residentId}`);
    }
    if (seenProfiles.has(profile.id)) {
      throw new Error(`Daily event resident profile is ambiguous: ${profile.id}`);
    }
    seenProfiles.add(profile.id);
    if (
      account.initialBalance === undefined
      || account.initializationSourceKey === undefined
      || account.initializedAt === undefined
    ) {
      throw new Error(`Daily event resident account is not fully initialized: ${profile.id}`);
    }
    validatePersistedResident({
      ...account,
      initialBalance: account.initialBalance,
      initializationSourceKey: account.initializationSourceKey,
      initializedAt: account.initializedAt,
    }, new Map([[profile.id, { playerId: participant.residentId }]]));
    if (args.now < account.updatedAt) {
      throw new Error(`Daily event reward timestamp precedes resident state: ${profile.id}`);
    }

    const earnedTiers = DAILY_EVENT_REWARD_TIERS.filter((tier) =>
      tier.key === 'participation'
      || (tier.key === 'finalist' && participant.reachedFinal)
      || (tier.key === 'champion' && participant.champion),
    );
    const entries = earnedTiers.map((tier): EconomyLedgerEntry => {
      const key = `event:${args.eventId}:${participant.residentId}:${tier.key}`;
      return {
        worldId: args.worldId,
        idempotencyKey: key,
        dayKey: args.dayKey,
        residentId: participant.residentId,
        kind: 'event-reward',
        amount: tier.amount,
        sourceKey: key,
        text: `${participant.displayName}获得每日活动${tier.label}奖励 ${tier.amount} 金贝。`,
        createdAt: args.now,
      };
    });
    const reward = entries.reduce((sum, entry) => sum + entry.amount, 0);
    const dayIncome = account.dayKey === args.dayKey ? account.todayIncome : 0;
    const dayExpense = account.dayKey === args.dayKey ? account.todayExpense : 0;
    for (const entry of entries) {
      validateLedgerEntryShape(entry);
      await validateLedgerContract(ctx, entry);
    }
    accountPlans.push({
      accountId: account._id,
      profileId: profile.id,
      balance: account.balance + reward,
      todayIncome: dayIncome + reward,
      todayExpense: dayExpense,
    });
    allEntries.push(...entries);
  }
  if (seenProfiles.size !== configuredProfiles.size) {
    throw new Error('Daily event participants do not cover every configured resident');
  }

  const existingEntries = [];
  for (const entry of allEntries) {
    const existing = await ctx.db
      .query('economyLedger')
      .withIndex('idempotencyKey', (q) =>
        q.eq('worldId', args.worldId).eq('idempotencyKey', entry.idempotencyKey),
      )
      .unique();
    if (existing && !dailyRewardLedgerEquivalent(existing, entry, args.now)) {
      throw new Error(`Daily event reward collision: ${entry.idempotencyKey}`);
    }
    existingEntries.push(existing);
  }
  const existingCount = existingEntries.filter(Boolean).length;
  const totalAmount = allEntries.reduce((sum, entry) => sum + entry.amount, 0);
  if (existingCount === allEntries.length) {
    return { status: 'already-settled' as const, ledgerEntries: allEntries.length, totalAmount };
  }
  if (existingCount !== 0) {
    throw new Error('Daily event reward collision: partial prior settlement');
  }

  for (const plan of accountPlans) {
    if (
      !isBoundedSafeInteger(plan.balance, MAX_MONEY)
      || !isBoundedSafeInteger(plan.todayIncome, MAX_MONEY)
      || !isBoundedSafeInteger(plan.todayExpense, MAX_MONEY)
    ) {
      throw new Error(`Daily event reward money boundary exceeded: ${plan.profileId}`);
    }
  }

  for (const plan of accountPlans) {
    await ctx.db.patch(plan.accountId, {
      balance: plan.balance,
      todayIncome: plan.todayIncome,
      todayExpense: plan.todayExpense,
      dayKey: args.dayKey,
      updatedAt: args.now,
    });
  }
  for (const entry of allEntries) await ctx.db.insert('economyLedger', entry);
  return { status: 'settled' as const, ledgerEntries: allEntries.length, totalAmount };
}

function validateDailyEventRewardInput(args: DailyEventRewardSettlementArgs) {
  assertDateTimestamp(args.now, 'Daily event reward now');
  assertDayKey(args.dayKey, 'Daily event reward dayKey');
  if (shanghaiEconomyDayKey(args.now) !== args.dayKey) {
    throw new Error('Daily event reward dayKey must match now in Asia/Shanghai');
  }
  if (
    args.hostServices !== null
    && (!Array.isArray(args.hostServices) || args.hostServices.length !== 0)
  ) {
    throw new Error('Daily event host services are not configured for settlement');
  }
}

function validatePersistedDailyEventParticipants(
  rows: ReadonlyArray<{
    residentId: string;
    displayName: string;
    identity: string;
    active: boolean;
    role: string;
    reachedFinal?: boolean;
  }>,
  winnerId: string | undefined,
) {
  if (rows.length !== 9) throw new Error('Daily event must persist exactly nine participants');
  const residentIds = new Set<string>();
  const participants = rows.map((participant) => {
    assertBoundedString(participant.residentId, 80, 'Daily event residentId');
    assertBoundedString(participant.displayName, 80, 'Daily event displayName');
    assertBoundedString(participant.identity, 500, 'Daily event identity');
    if (typeof participant.reachedFinal !== 'boolean') {
      throw new Error('Daily event reachedFinal must be persisted as a boolean');
    }
    if (residentIds.has(participant.residentId)) {
      throw new Error(`Duplicate daily event resident: ${participant.residentId}`);
    }
    residentIds.add(participant.residentId);
    const champion = participant.role === 'winner';
    if (champion) {
      if (!participant.active || !participant.reachedFinal) {
        throw new Error('Daily event winner must be active and must have reached the final');
      }
    } else if (participant.role !== 'spectator' || participant.active) {
      throw new Error('Completed daily event non-winners must be inactive spectators');
    }
    return {
      residentId: participant.residentId,
      displayName: participant.displayName,
      identity: participant.identity,
      reachedFinal: participant.reachedFinal,
      champion,
    };
  });
  const champions = participants.filter((participant) => participant.champion);
  if (champions.length !== 1) throw new Error('Daily event requires exactly one persisted winner');
  if (!winnerId || champions[0].residentId !== winnerId) {
    throw new Error('Persisted daily event winner does not match the event winner');
  }
  return participants;
}

function dailyRewardLedgerEquivalent(
  existing: Record<string, unknown>,
  expected: EconomyLedgerEntry,
  replayedAt: number,
) {
  validateLedgerEntryShape(existing as unknown as EconomyLedgerEntry);
  if (typeof existing.createdAt !== 'number' || existing.createdAt > replayedAt) return false;
  return [
    'worldId', 'idempotencyKey', 'dayKey', 'residentId', 'institutionId', 'kind',
    'amount', 'expectedAmount', 'compensationKind', 'item', 'quantity', 'sourceKey', 'text',
  ].every(
    (field) => existing[field] === (expected as unknown as Record<string, unknown>)[field],
  );
}

export function validateActivityRegistration(
  args: Omit<ActivitySettlementArgs, 'now' | 'terminalFailureReason'>,
  createdAt: number,
) {
  assertDateTimestamp(createdAt, 'activity createdAt');
  assertDateTimestamp(args.activityUntil, 'activityUntil');
  if (args.activityUntil < createdAt || args.activityUntil - createdAt > 86_400_000) {
    throw new Error('activityUntil must be within one day after registration');
  }
  for (const [key, label] of [
    [`activity:${args.operationId}`, 'activity operationId'],
    [`activity:${args.operationId}:start`, 'activity start sourceKey'],
    [`activity:${args.operationId}:complete`, 'activity completion sourceKey'],
    [`activity:${args.operationId}:failed`, 'activity failure sourceKey'],
    [
      `activity:${args.worldId}:${args.residentId}:${args.operationId}`,
      'activity idempotencyKey',
    ],
  ] as const) {
    assertCanonicalKey(key, label);
  }
  assertBoundedString(args.activityText, MAX_LEDGER_TEXT_LENGTH, 'activityText');
  const landmark = townLandmarks.find((entry) => entry.id === args.landmarkId);
  if (!landmark) throw new Error(`Unknown town landmark: ${args.landmarkId}`);
  const action = args.economicAction;
  if (action.kind === 'rest') {
    if (args.category !== 'care') throw new Error('rest activity category mismatch');
    return;
  }
  const definition = institutionDefinition(action.institutionId);
  if (definition.landmarkId !== landmark.id) throw new Error('activity institution landmark mismatch');
  if (action.kind === 'purchase') {
    if (args.category !== 'food') throw new Error('purchase activity category mismatch');
    if (!definition.goods.includes(action.goodId)) throw new Error('purchase good mismatch');
    assertPositiveQuantity(action.quantity, 'purchase quantity');
    return;
  }
  if (args.category !== 'work') throw new Error('work activity category mismatch');
  assertPositiveQuantity(action.output.quantity, 'work quantity');
  const outputId = action.output.kind === 'stock' ? action.output.item : action.output.serviceId;
  const offered = action.output.kind === 'stock'
    ? definition.goods.includes(action.output.item)
    : definition.serviceIds.includes(action.output.serviceId);
  if (!offered || !outputId) throw new Error('work output institution mismatch');
}

export async function settleActivity(
  ctx: EconomyDbContext,
  args: ActivitySettlementArgs,
) {
  const now = args.now ?? Date.now();
  validateActivityRegistration(args, Math.min(now, args.activityUntil));
  assertDateTimestamp(now, 'settlement now');
  const status = await ctx.db
    .query('worldStatus')
    .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
    .unique();
  if (!status || status.status !== 'running') return { status: 'world-not-running' as const };

  const idempotencyKey = `activity:${args.worldId}:${args.residentId}:${args.operationId}`;
  const sourceKey = `activity:${args.operationId}`;
  assertCanonicalKey(idempotencyKey, 'activity idempotencyKey');
  assertCanonicalKey(sourceKey, 'activity sourceKey');
  const priorLedger = await ctx.db
    .query('economyLedger')
    .withIndex('idempotencyKey', (q) =>
      q.eq('worldId', args.worldId).eq('idempotencyKey', idempotencyKey),
    )
    .unique();

  await ensureActivityEconomyInitialized(ctx, args, now);
  await ensureDailyEconomyAdvanced(ctx, args.worldId, now);
  const world = await ctx.db.get(args.worldId);
  if (!world) return { status: 'resident-not-active' as const };
  const player = world.players.find((candidate) => candidate.id === args.residentId);
  const activeAgentCount = world.agents.filter(
    (candidate) => candidate.playerId === args.residentId,
  ).length;
  if (!player || player.human !== undefined || activeAgentCount !== 1) {
    return { status: 'resident-not-active' as const };
  }
  const account = await ctx.db
    .query('residentEconomy')
    .withIndex('resident', (q) =>
      q.eq('worldId', args.worldId).eq('residentId', args.residentId),
    )
    .unique();
  if (!account) return { status: 'resident-account-missing' as const };
  const startEvent = await activityEventBySource(
    ctx,
    args.worldId,
    `activity:${args.operationId}:start`,
  );
  if (
    !startEvent
    || startEvent.text !== `开始${args.activityText}`
    || startEvent.createdAt > args.activityUntil
    || startEvent.residentId !== args.residentId
    || startEvent.operationId !== args.operationId
    || startEvent.phase !== 'start'
    || startEvent.category !== args.category
    || startEvent.landmarkId !== args.landmarkId
    || startEvent.economicActionJson !== serializeEconomicAction(args.economicAction)
    || startEvent.activityUntil !== args.activityUntil
  ) {
    const [completed, failed] = await Promise.all([
      activityEventBySource(ctx, args.worldId, `activity:${args.operationId}:complete`),
      activityEventBySource(ctx, args.worldId, `activity:${args.operationId}:failed`),
    ]);
    if (priorLedger || completed || failed) {
      throw new Error(`activity operation collision: ${args.operationId}`);
    }
    return { status: 'operation-mismatch' as const };
  }
  validateActivityRegistration(args, startEvent.createdAt);
  const priorOutcome = await priorNonFinancialActivityOutcome(
    ctx, args, priorLedger, account,
  );
  if (priorOutcome?.status === 'already-failed') return priorOutcome;
  if (priorOutcome) return priorOutcome;
  if (priorLedger) {
    const completionFact = validatePriorLedgerCompletion(priorLedger, args, account);
    await recordCompletedActivity(ctx, args, now, completionFact);
    return { status: 'already-settled' as const };
  }
  if (
    !player.activity
    || player.activity.description !== args.activityText
    || player.activity.until !== args.activityUntil
  ) {
    await recordActivityOutcome(
      ctx, args, now, 'failed', '活动未完成：居民已经改做其他事情。', 'activity-replaced',
    );
    return { status: 'rejected' as const, reason: 'activity-replaced' as const };
  }
  if (now < args.activityUntil) return { status: 'activity-not-complete' as const };
  const landmark = townLandmarkById(args.landmarkId);
  if (distance(player.position, landmark.destination) > 2) {
    if (args.terminalFailureReason === 'destination-not-reached') {
      await recordActivityOutcome(
        ctx, args, now, 'failed', '活动未完成：到达宽限期结束时仍未到达地点。',
        'destination-not-reached',
      );
      return { status: 'rejected' as const, reason: 'destination-not-reached' as const };
    }
    const destinationProgressing = !!player.pathfinding
      && distance(player.pathfinding.destination, landmark.destination) < 0.01;
    return { status: 'destination-not-reached' as const, destinationProgressing };
  }
  const dayKey = shanghaiEconomyDayKey(now);
  const residentIncome = account.dayKey === dayKey ? account.todayIncome : 0;
  const residentExpense = account.dayKey === dayKey ? account.todayExpense : 0;
  const economicAction = args.economicAction;

  if (economicAction.kind === 'rest') {
    if (!isBoundedSafeInteger(residentIncome, MAX_MONEY)
      || !isBoundedSafeInteger(residentExpense, MAX_MONEY)) {
      await recordActivityOutcome(
        ctx, args, now, 'failed', '休息记录未完成：日累计值超过安全边界。',
        'counter-boundary-exceeded',
      );
      return { status: 'rejected' as const, reason: 'counter-boundary-exceeded' as const };
    }
    const needs = decayResidentNeeds(account);
    await ctx.db.patch(account._id, {
      energy: Math.min(100, needs.energy + 25),
      hunger: needs.hunger,
      todayIncome: residentIncome,
      todayExpense: residentExpense,
      dayKey,
      updatedAt: now,
    });
    await recordActivityOutcome(ctx, args, now, 'complete', '休息已经完成。');
    return { status: 'settled' as const, amount: 0 };
  }

  const definition = institutionDefinition(economicAction.institutionId);
  if (definition.landmarkId !== args.landmarkId) {
    return { status: 'institution-location-mismatch' as const };
  }
  const institution = await ctx.db
    .query('townInstitutions')
    .withIndex('institution', (q) =>
      q.eq('worldId', args.worldId)
        .eq('institutionId', economicAction.institutionId),
    )
    .unique();
  if (!institution) return { status: 'institution-missing' as const };
  const institutionIncome = institution.dayKey === dayKey ? institution.todayIncome : 0;
  const institutionExpense = institution.dayKey === dayKey ? institution.todayExpense : 0;
  const visitors = institution.dayKey === dayKey ? institution.visitorCount : 0;

  if (economicAction.kind === 'work') {
    const profile = residentProfile(account.profileId);
    if (
      profile.institutionId !== economicAction.institutionId
      || JSON.stringify(profile.workOutput) !== JSON.stringify(economicAction.output)
    ) {
      return { status: 'work-profile-mismatch' as const };
    }
    const output = economicAction.output;
    if (priorLedger) {
      assertPriorActivityLedger(
        priorLedger, args, profile.compensation.amount, profile.compensation.kind,
      );
      return { status: 'already-settled' as const };
    }
    const counters = output.kind === 'stock'
      ? parseCounterJson(institution.stockJson)
      : parseCounterJson(institution.serviceCountersJson);
    const item = output.kind === 'stock' ? output.item : output.serviceId;
    const result = settleWork(
      {
        residentBalance: account.balance,
        institutionCash: institution.cash,
        stock: counters[item] ?? 0,
      },
      { pay: profile.compensation.amount, output: output.quantity },
    );
    if (!result.ok) {
      await recordActivityOutcome(
        ctx, args, now, 'failed', '工作未完成：经济状态或产出已达到安全边界。',
        'invalid-work-state',
      );
      return { status: 'rejected' as const, reason: 'invalid-work-state' as const };
    }
    const amount = result.residentBalance - account.balance;
    if (
      !isBoundedSafeInteger(residentIncome + amount, MAX_MONEY)
      || !isBoundedSafeInteger(residentExpense, MAX_MONEY)
      || !isBoundedSafeInteger(institutionIncome, MAX_MONEY)
      || !isBoundedSafeInteger(institutionExpense + amount, MAX_MONEY)
      || !isBoundedSafeInteger(visitors, MAX_STOCK)
    ) {
      await recordActivityOutcome(
        ctx, args, now, 'failed', '工作未完成：日累计值超过安全边界。',
        'counter-boundary-exceeded',
      );
      return { status: 'rejected' as const, reason: 'counter-boundary-exceeded' as const };
    }
    counters[item] = result.stock;
    const needs = decayResidentNeeds(account);
    await ctx.db.patch(account._id, {
      balance: result.residentBalance,
      hunger: needs.hunger,
      energy: needs.energy,
      todayIncome: residentIncome + amount,
      todayExpense: residentExpense,
      dayKey,
      updatedAt: now,
    });
    await ctx.db.patch(institution._id, {
      cash: result.institutionCash,
      ...(output.kind === 'stock'
        ? { stockJson: JSON.stringify(counters) }
        : { serviceCountersJson: JSON.stringify(counters) }),
      todayIncome: institutionIncome,
      todayExpense: institutionExpense + amount,
      visitorCount: visitors,
      dayKey,
      updatedAt: now,
    });
    await appendEconomyLedger(ctx, {
      worldId: args.worldId,
      idempotencyKey,
      dayKey,
      residentId: args.residentId,
      institutionId: definition.id,
      kind: 'work',
      amount,
      expectedAmount: profile.compensation.amount,
      compensationKind: profile.compensation.kind,
      item,
      quantity: output.quantity,
      sourceKey,
      text: `${args.activityText}，实际获得 ${amount} 金贝。`,
      createdAt: now,
    });
    await recordCompletedActivity(ctx, args, now, `工作完成，实际获得 ${amount} 金贝。`);
    return { status: 'settled' as const, amount };
  }

  const good = goods.find((candidate) => candidate.id === economicAction.goodId);
  if (!good || !definition.goods.includes(good.id)) {
    return { status: 'purchase-good-mismatch' as const };
  }
  if (priorLedger) {
    assertPriorActivityLedger(priorLedger, args, good.price * economicAction.quantity);
    return { status: 'already-settled' as const };
  }
  const stock = parseCounterJson(institution.stockJson);
  const result = settlePurchase(
    {
      residentBalance: account.balance,
      institutionCash: institution.cash,
      stock: stock[good.id] ?? 0,
    },
    { price: good.price, quantity: economicAction.quantity },
  );
  if (!result.ok) {
    await recordActivityOutcome(
      ctx,
      args,
      now,
      'failed',
      '消费未完成：余额不足或库存不足。',
      'insufficient-funds-or-stock',
    );
    return { status: 'rejected' as const, reason: 'insufficient-funds-or-stock' as const };
  }
  const amount = account.balance - result.residentBalance;
  if (
    !isBoundedSafeInteger(residentIncome, MAX_MONEY)
    || !isBoundedSafeInteger(residentExpense + amount, MAX_MONEY)
    || !isBoundedSafeInteger(institutionIncome + amount, MAX_MONEY)
    || !isBoundedSafeInteger(institutionExpense, MAX_MONEY)
    || !isBoundedSafeInteger(visitors + 1, MAX_STOCK)
  ) {
    await recordActivityOutcome(
      ctx, args, now, 'failed', '消费未完成：日累计值超过安全边界。',
      'counter-boundary-exceeded',
    );
    return { status: 'rejected' as const, reason: 'counter-boundary-exceeded' as const };
  }
  stock[good.id] = result.stock;
  const needs = decayResidentNeeds(account);
  await ctx.db.patch(account._id, {
    balance: result.residentBalance,
    hunger: Math.min(100, needs.hunger + (good.id === 'meal' ? 25 : 12)),
    energy: needs.energy,
    todayIncome: residentIncome,
    todayExpense: residentExpense + amount,
    dayKey,
    updatedAt: now,
  });
  await ctx.db.patch(institution._id, {
    cash: result.institutionCash,
    stockJson: JSON.stringify(stock),
    todayIncome: institutionIncome + amount,
    todayExpense: institutionExpense,
    visitorCount: visitors + 1,
    dayKey,
    updatedAt: now,
  });
  await appendEconomyLedger(ctx, {
    worldId: args.worldId,
    idempotencyKey,
    dayKey,
    residentId: args.residentId,
    institutionId: definition.id,
    kind: 'purchase',
    amount,
    item: good.id,
    quantity: economicAction.quantity,
    sourceKey,
    text: `${args.activityText}，实际支付 ${amount} 金贝。`,
    createdAt: now,
  });
  await recordInstitutionPurchaseTrade(ctx, {
    worldId: args.worldId,
    buyerResidentId: args.residentId,
    institutionId: definition.id,
    item: good.id,
    quantity: economicAction.quantity,
    economyIdempotencyKey: idempotencyKey,
    economySourceKey: sourceKey,
    createdAt: now,
  });
  await recordCompletedActivity(ctx, args, now, `消费完成，实际支付 ${amount} 金贝。`);
  return { status: 'settled' as const, amount };
}

async function ensureActivityEconomyInitialized(
  ctx: EconomyDbContext,
  args: ActivitySettlementArgs,
  now: number,
) {
  const [account, accountRows, institutionRows] = await Promise.all([
    ctx.db
    .query('residentEconomy')
    .withIndex('resident', (q) =>
      q.eq('worldId', args.worldId).eq('residentId', args.residentId),
    )
      .unique(),
    ctx.db
      .query('residentEconomy')
      .withIndex('world', (q) => q.eq('worldId', args.worldId))
      .take(residentEconomyProfiles.length + 1),
    ctx.db
      .query('townInstitutions')
      .withIndex('world', (q) => q.eq('worldId', args.worldId))
      .take(institutions.length + 1),
  ]);
  let institutionReady = true;
  if (args.economicAction.kind !== 'rest') {
    const institutionId = args.economicAction.institutionId;
    institutionReady = !!(await ctx.db
      .query('townInstitutions')
      .withIndex('institution', (q) =>
        q.eq('worldId', args.worldId)
          .eq('institutionId', institutionId),
      )
      .unique());
  }
  const complete = accountRows.length === residentEconomyProfiles.length
    && institutionRows.length === institutions.length;
  if (!account || !institutionReady || !complete) {
    await initializeTownEconomy(ctx, args.worldId, now);
  }
}

async function recordCompletedActivity(
  ctx: EconomyDbContext,
  args: ActivitySettlementArgs,
  createdAt: number,
  fact: string,
) {
  await recordActivityOutcome(ctx, args, createdAt, 'complete', fact);
}

async function activityEventBySource(
  ctx: EconomyDbContext,
  worldId: Id<'worlds'>,
  sourceKey: string,
) {
  return ctx.db
    .query('lifeEvents')
    .withIndex('sourceKey', (q) =>
      q.eq('worldId', worldId).eq('sourceKey', sourceKey),
    )
    .unique();
}

async function priorNonFinancialActivityOutcome(
  ctx: EconomyDbContext,
  args: ActivitySettlementArgs,
  priorLedger: {
    kind: string;
    residentId?: string;
    institutionId?: string;
    amount: number;
    expectedAmount?: number;
    compensationKind?: CompensationKind;
    item?: string;
    quantity?: number;
    sourceKey: string;
    text: string;
    createdAt: number;
  } | null,
  account: { profileId: string },
) {
  const phases = ['complete', 'failed'] as const;
  const outcomes = await Promise.all(phases.map((phase) => activityEventBySource(
    ctx,
    args.worldId,
    `activity:${args.operationId}:${phase}`,
  )));
  if (outcomes.every(Boolean)) {
    throw new Error(`activity outcome collision: ${args.operationId}`);
  }
  for (const [index, phase] of phases.entries()) {
    const event = outcomes[index];
    if (!event) continue;
    if (
      event.residentId !== args.residentId
      || event.operationId !== args.operationId
      || event.phase !== phase
      || event.category !== args.category
      || event.landmarkId !== args.landmarkId
      || event.economicActionJson !== serializeEconomicAction(args.economicAction)
      || event.activityUntil !== args.activityUntil
    ) {
      throw new Error(`activity outcome collision: ${args.operationId}`);
    }
    if (phase === 'failed') {
      if (
        !event.failureReason
        || event.text !== `${args.activityText}；${activityFailureFact(
          event.failureReason,
          args.economicAction,
        )}`
      ) {
        throw new Error(`activity outcome collision: ${args.operationId}`);
      }
    } else {
      if (event.failureReason !== undefined) {
        throw new Error(`activity outcome collision: ${args.operationId}`);
      }
      const fact = args.economicAction.kind === 'rest'
        ? '休息已经完成。'
        : priorLedger && validatePriorLedgerCompletion(priorLedger, args, account);
      if (!fact || event.text !== `${args.activityText}；${fact}`) {
        throw new Error(`activity outcome collision: ${args.operationId}`);
      }
    }
    return phase === 'failed'
      ? {
        status: 'already-failed' as const,
        reason: event.failureReason ?? 'unknown-failure',
      }
      : { status: 'already-settled' as const };
  }
  return undefined;
}

async function recordActivityOutcome(
  ctx: EconomyDbContext,
  args: ActivitySettlementArgs,
  createdAt: number,
  phase: 'complete' | 'failed',
  fact: string,
  failureReason?: string,
) {
  if (phase === 'failed') {
    if (!failureReason || fact !== activityFailureFact(failureReason, args.economicAction)) {
      throw new Error('failed activity outcome requires its exact normative failure reason');
    }
  } else if (failureReason !== undefined) {
    throw new Error('completed activity outcome cannot have a failure reason');
  }
  const sourceKey = `activity:${args.operationId}:${phase}`;
  const existing = await activityEventBySource(ctx, args.worldId, sourceKey);
  const text = `${args.activityText}；${fact}`;
  const economicActionJson = serializeEconomicAction(args.economicAction);
  if (existing) {
    if (
      existing.residentId === args.residentId
      && existing.operationId === args.operationId
      && existing.phase === phase
      && existing.category === args.category
      && existing.landmarkId === args.landmarkId
      && existing.economicActionJson === economicActionJson
      && existing.activityUntil === args.activityUntil
      && existing.failureReason === failureReason
      && existing.text === text
    ) return false;
    throw new Error(`activity outcome collision: ${args.operationId}`);
  }
  await ctx.db.insert('lifeEvents', {
    worldId: args.worldId,
    residentId: args.residentId,
    kind: args.category,
    text,
    createdAt,
    sourceKey,
    operationId: args.operationId,
    phase,
    category: args.category,
    landmarkId: args.landmarkId,
    economicActionJson,
    activityUntil: args.activityUntil,
    ...(failureReason ? { failureReason } : {}),
  });
  return true;
}

function activityFailureFact(reason: string, action: EconomicAction) {
  switch (reason) {
    case 'activity-replaced':
      return '活动未完成：居民已经改做其他事情。';
    case 'destination-not-reached':
      return '活动未完成：到达宽限期结束时仍未到达地点。';
    case 'invalid-work-state':
      return '工作未完成：经济状态或产出已达到安全边界。';
    case 'insufficient-funds-or-stock':
      return '消费未完成：余额不足或库存不足。';
    case 'counter-boundary-exceeded':
      return action.kind === 'work'
        ? '工作未完成：日累计值超过安全边界。'
        : action.kind === 'purchase'
          ? '消费未完成：日累计值超过安全边界。'
          : '休息记录未完成：日累计值超过安全边界。';
    default:
      throw new Error(`Unknown activity failure reason: ${reason}`);
  }
}

function validatePriorLedgerCompletion(
  entry: Parameters<typeof assertPriorActivityLedger>[0],
  args: ActivitySettlementArgs,
  account: { profileId: string },
) {
  const action = args.economicAction;
  if (action.kind === 'rest') {
    throw new Error(`activity ledger collision: ${args.operationId}`);
  }
  if (action.kind === 'work') {
    const profile = residentProfile(account.profileId);
    assertPriorActivityLedger(
      entry, args, profile.compensation.amount, profile.compensation.kind,
    );
    return `工作完成，实际获得 ${entry.amount} 金贝。`;
  }
  const good = goods.find((candidate) => candidate.id === action.goodId);
  if (!good) throw new Error(`activity ledger collision: ${args.operationId}`);
  assertPriorActivityLedger(entry, args, good.price * action.quantity);
  return `消费完成，实际支付 ${entry.amount} 金贝。`;
}

function assertPriorActivityLedger(
  entry: {
    kind: string;
    residentId?: string;
    institutionId?: string;
    amount: number;
    expectedAmount?: number;
    compensationKind?: CompensationKind;
    item?: string;
    quantity?: number;
    sourceKey: string;
    text: string;
    createdAt: number;
  },
  args: ActivitySettlementArgs,
  expectedAmount: number,
  compensationKind?: CompensationKind,
) {
  const action = args.economicAction;
  const expectedKind = action.kind === 'work' ? 'work' : 'purchase';
  const expectedInstitution = action.kind === 'rest' ? undefined : action.institutionId;
  const expectedItem = action.kind === 'work'
    ? action.output.kind === 'stock' ? action.output.item : action.output.serviceId
    : action.kind === 'purchase' ? action.goodId : undefined;
  const expectedQuantity = action.kind === 'work'
    ? action.output.quantity
    : action.kind === 'purchase' ? action.quantity : undefined;
  const expectedText = action.kind === 'work'
    ? `${args.activityText}，实际获得 ${entry.amount} 金贝。`
    : `${args.activityText}，实际支付 ${entry.amount} 金贝。`;
  const validAmount = action.kind === 'work'
    ? entry.amount <= expectedAmount
      && entry.expectedAmount === expectedAmount
      && (entry.compensationKind === undefined || entry.compensationKind === compensationKind)
    : entry.amount === expectedAmount && entry.expectedAmount === undefined;
  if (
    entry.kind !== expectedKind
    || entry.residentId !== args.residentId
    || entry.institutionId !== expectedInstitution
    || entry.item !== expectedItem
    || entry.quantity !== expectedQuantity
    || entry.sourceKey !== `activity:${args.operationId}`
    || entry.text !== expectedText
    || entry.createdAt < args.activityUntil
    || !validAmount
  ) {
    throw new Error(`activity idempotency collision: ${args.operationId}`);
  }
}

function serializeEconomicAction(action: EconomicAction) {
  switch (action.kind) {
    case 'rest':
      return '{"kind":"rest"}';
    case 'purchase':
      return JSON.stringify({
        kind: action.kind,
        institutionId: action.institutionId,
        goodId: action.goodId,
        quantity: action.quantity,
      });
    case 'work':
      return JSON.stringify({
        kind: action.kind,
        institutionId: action.institutionId,
        output: action.output.kind === 'stock'
          ? {
            kind: action.output.kind,
            item: action.output.item,
            quantity: action.output.quantity,
          }
          : {
            kind: action.output.kind,
            serviceId: action.output.serviceId,
            quantity: action.output.quantity,
          },
      });
  }
}

function parseCounterJson(json: string): Record<string, number> {
  const parsed = JSON.parse(json) as Record<string, number>;
  return { ...parsed };
}

function decayResidentNeeds(account: { hunger: number; energy: number }) {
  return {
    hunger: Math.max(0, account.hunger - 1),
    energy: Math.max(0, account.energy - 1),
  };
}

export const initializeForWorld = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => initializeTownEconomy(ctx, args.worldId),
});

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
  const activeAiPlayerIds = new Set(
    world.players
      .filter((player) => player.human === undefined && agentCounts.get(player.id) === 1)
      .map((player) => player.id),
  );
  const descriptionsByProfileId = new Map<string, typeof descriptions>();
  for (const description of descriptions) {
    if (!activeAiPlayerIds.has(description.playerId)) continue;
    const profile = residentEconomyProfiles.find((entry) => entry.name === description.name);
    if (!profile) continue;
    const candidates = descriptionsByProfileId.get(profile.id) ?? [];
    candidates.push(description);
    descriptionsByProfileId.set(profile.id, candidates);
  }

  const resolvedByProfileId = new Map<string, (typeof descriptions)[number]>();
  const conflicts = new Set<string>();
  const missing = new Set<string>();
  for (const profile of residentEconomyProfiles) {
    const candidates = descriptionsByProfileId.get(profile.id) ?? [];
    if (candidates.length === 0) missing.add(profile.name);
    else if (candidates.length > 1) conflicts.add(profile.name);
    else resolvedByProfileId.set(profile.id, candidates[0]);
  }
  const profilesByPlayerId = new Map<string, string[]>();
  for (const [profileId, description] of resolvedByProfileId) {
    const profileIds = profilesByPlayerId.get(description.playerId) ?? [];
    profileIds.push(profileId);
    profilesByPlayerId.set(description.playerId, profileIds);
  }
  for (const profileIds of profilesByPlayerId.values()) {
    if (profileIds.length < 2) continue;
    for (const profileId of profileIds) {
      const profile = residentProfile(profileId);
      conflicts.add(profile.name);
      resolvedByProfileId.delete(profileId);
    }
  }
  const orderedNames = (names: Set<string>) =>
    residentEconomyProfiles.map((profile) => profile.name).filter((name) => names.has(name));
  return {
    resolvedByProfileId,
    missingResidentNames: orderedNames(missing),
    conflictingResidentNames: orderedNames(conflicts),
  };
}

async function migrateLegacyResident<T extends {
  _id: Id<'residentEconomy'>;
  _creationTime: number;
  profileId: string;
  updatedAt: number;
  initialBalance?: number;
  initializationSourceKey?: string;
  initializedAt?: number;
}>(
  ctx: EconomyDbContext,
  row: T,
) {
  const profile = residentProfile(row.profileId);
  const backfill = {
    ...(row.initialBalance === undefined ? { initialBalance: profile.startingBalance } : {}),
    ...(row.initializationSourceKey === undefined
      ? { initializationSourceKey: residentInitializationSource(row.profileId) }
      : {}),
    ...(row.initializedAt === undefined ? { initializedAt: row._creationTime } : {}),
  };
  if (Object.keys(backfill).length > 0) await ctx.db.patch(row._id, backfill);
  return { ...row, ...backfill } as T & {
    initialBalance: number;
    initializationSourceKey: string;
    initializedAt: number;
  };
}

async function migrateLegacyInstitution<T extends {
  _id: Id<'townInstitutions'>;
  _creationTime: number;
  institutionId: string;
  updatedAt: number;
  initialCash?: number;
  initialStockJson?: string;
  initialServiceCountersJson?: string;
  initializationSourceKey?: string;
  initializedAt?: number;
}>(
  ctx: EconomyDbContext,
  row: T,
) {
  const definition = institutionDefinition(row.institutionId);
  const backfill = {
    ...(row.initialCash === undefined ? { initialCash: STARTING_INSTITUTION_CASH } : {}),
    ...(row.initialStockJson === undefined
      ? { initialStockJson: JSON.stringify(initialStock(definition)) }
      : {}),
    ...(row.initialServiceCountersJson === undefined
      ? { initialServiceCountersJson: JSON.stringify(initialServiceCounters(definition)) }
      : {}),
    ...(row.initializationSourceKey === undefined
      ? { initializationSourceKey: institutionInitializationSource(row.institutionId) }
      : {}),
    ...(row.initializedAt === undefined ? { initializedAt: row._creationTime } : {}),
  };
  if (Object.keys(backfill).length > 0) await ctx.db.patch(row._id, backfill);
  return { ...row, ...backfill } as T & {
    initialCash: number;
    initialStockJson: string;
    initialServiceCountersJson: string;
    initializationSourceKey: string;
    initializedAt: number;
  };
}

function validatePersistedResident(
  row: {
    residentId: string;
    profileId: string;
    balance: number;
    initialBalance: number;
    hunger: number;
    energy: number;
    todayIncome: number;
    todayExpense: number;
    dayKey: string;
    initializationSourceKey: string;
    initializedAt: number;
    updatedAt: number;
  },
  runtime: ReadonlyMap<string, { playerId: string }>,
) {
  const profile = residentProfile(row.profileId);
  const mapped = runtime.get(row.profileId);
  if (!mapped || mapped.playerId !== row.residentId) {
    throw new Error(`Resident economy runtime mapping mismatch: ${row.profileId}`);
  }
  assertBoundedSafeInteger(row.balance, MAX_MONEY, `${row.profileId}.balance`);
  assertBoundedSafeInteger(row.initialBalance, MAX_MONEY, `${row.profileId}.initialBalance`);
  if (row.initialBalance !== profile.startingBalance) {
    throw new Error(`Resident economy initialBalance mismatch: ${row.profileId}`);
  }
  assertBoundedSafeInteger(row.hunger, 100, `${row.profileId}.hunger`);
  assertBoundedSafeInteger(row.energy, 100, `${row.profileId}.energy`);
  assertBoundedSafeInteger(row.todayIncome, MAX_MONEY, `${row.profileId}.todayIncome`);
  assertBoundedSafeInteger(row.todayExpense, MAX_MONEY, `${row.profileId}.todayExpense`);
  assertDayKey(row.dayKey, `${row.profileId}.dayKey`);
  if (row.initializationSourceKey !== residentInitializationSource(row.profileId)) {
    throw new Error(`Resident economy initialization source mismatch: ${row.profileId}`);
  }
  assertDateTimestamp(row.initializedAt, `${row.profileId}.initializedAt`);
  assertDateTimestamp(row.updatedAt, `${row.profileId}.updatedAt`);
  if (row.dayKey !== shanghaiEconomyDayKey(row.updatedAt)) {
    throw new Error(`Resident economy dayKey must match updatedAt: ${row.profileId}`);
  }
  if (row.updatedAt < row.initializedAt) {
    throw new Error(`Resident economy updatedAt precedes initialization: ${row.profileId}`);
  }
}

function validatePersistedInstitution(row: {
  institutionId: string;
  cash: number;
  initialCash: number;
  stockJson: string;
  initialStockJson: string;
  serviceCountersJson: string;
  initialServiceCountersJson: string;
  todayIncome: number;
  todayExpense: number;
  visitorCount: number;
  dayKey: string;
  initializationSourceKey: string;
  initializedAt: number;
  updatedAt: number;
}) {
  const definition = institutionDefinition(row.institutionId);
  assertBoundedSafeInteger(row.cash, MAX_MONEY, `${row.institutionId}.cash`);
  assertBoundedSafeInteger(row.initialCash, MAX_MONEY, `${row.institutionId}.initialCash`);
  if (row.initialCash !== STARTING_INSTITUTION_CASH) {
    throw new Error(`Town institution initialCash mismatch: ${row.institutionId}`);
  }
  validateCounterJson(row.stockJson, definition.goods, `${row.institutionId}.stockJson`);
  validateCounterJson(
    row.serviceCountersJson,
    definition.serviceIds,
    `${row.institutionId}.serviceCountersJson`,
  );
  if (row.initialStockJson !== JSON.stringify(initialStock(definition))) {
    throw new Error(`Town institution initialStockJson mismatch: ${row.institutionId}`);
  }
  if (row.initialServiceCountersJson !== JSON.stringify(initialServiceCounters(definition))) {
    throw new Error(`Town institution initialServiceCountersJson mismatch: ${row.institutionId}`);
  }
  assertBoundedSafeInteger(row.todayIncome, MAX_MONEY, `${row.institutionId}.todayIncome`);
  assertBoundedSafeInteger(row.todayExpense, MAX_MONEY, `${row.institutionId}.todayExpense`);
  assertBoundedSafeInteger(row.visitorCount, MAX_STOCK, `${row.institutionId}.visitorCount`);
  assertDayKey(row.dayKey, `${row.institutionId}.dayKey`);
  if (row.initializationSourceKey !== institutionInitializationSource(row.institutionId)) {
    throw new Error(`Town institution initialization source mismatch: ${row.institutionId}`);
  }
  assertDateTimestamp(row.initializedAt, `${row.institutionId}.initializedAt`);
  assertDateTimestamp(row.updatedAt, `${row.institutionId}.updatedAt`);
  if (row.dayKey !== shanghaiEconomyDayKey(row.updatedAt)) {
    throw new Error(`Town institution dayKey must match updatedAt: ${row.institutionId}`);
  }
  if (row.updatedAt < row.initializedAt) {
    throw new Error(`Town institution updatedAt precedes initialization: ${row.institutionId}`);
  }
}

function validateCounterJson(json: string, allowedKeys: readonly string[], label: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!isPlainRecord(parsed)) throw new Error(`${label} must be an object`);
  const actualKeys = Object.keys(parsed).sort();
  const expectedKeys = [...allowedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${label} has invalid keys`);
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'number') throw new Error(`${label}.${key} must be a number`);
    assertBoundedSafeInteger(value, MAX_STOCK, `${label}.${key}`);
  }
}

function validateLedgerEntryShape(entry: EconomyLedgerEntry) {
  const runtimeKind = (entry as { kind?: unknown }).kind;
  const runtime = entry as unknown as Record<string, unknown>;
  if (
    runtimeKind !== 'work'
    && runtimeKind !== 'purchase'
    && runtimeKind !== 'restock'
    && runtimeKind !== 'event-reward'
    && runtimeKind !== 'event-service'
  ) {
    throw new Error(`Unknown ledger kind: ${String(runtimeKind)}`);
  }
  assertCanonicalKey(entry.idempotencyKey, 'idempotencyKey');
  assertCanonicalKey(entry.sourceKey, 'sourceKey');
  assertBoundedString(entry.text, MAX_LEDGER_TEXT_LENGTH, 'text');
  if (entry.residentId !== undefined) assertBoundedString(entry.residentId, 80, 'residentId');
  if (entry.institutionId !== undefined) {
    assertBoundedString(entry.institutionId, 80, 'institutionId');
  }
  if (entry.item !== undefined) assertBoundedString(entry.item, 80, 'item');
  assertBoundedSafeInteger(entry.amount, MAX_MONEY, 'amount');
  if (entry.expectedAmount !== undefined) {
    assertBoundedSafeInteger(entry.expectedAmount, MAX_MONEY, 'expectedAmount');
  }
  const runtimeCompensationKind = runtime.compensationKind;
  if (runtimeCompensationKind !== undefined) {
    if (
      runtimeCompensationKind !== 'wage'
      && runtimeCompensationKind !== 'owner-draw'
      && runtimeCompensationKind !== 'contract-share'
    ) {
      throw new Error('compensationKind is invalid');
    }
  }
  if (entry.quantity !== undefined) {
    if (runtimeKind === 'restock') {
      assertBoundedSafeInteger(entry.quantity, MAX_STOCK, 'quantity');
    } else {
      assertPositiveQuantity(entry.quantity, 'quantity');
    }
  }
  const requireField = (field: string) => {
    if (runtime[field] === undefined) throw new Error(`${runtimeKind} ${field} is required`);
  };
  const forbidField = (field: string) => requireAbsent(runtime[field], `${runtimeKind} ${field}`);
  switch (runtimeKind) {
    case 'work':
      for (const field of [
        'residentId', 'institutionId', 'expectedAmount', 'compensationKind', 'item', 'quantity',
      ]) {
        requireField(field);
      }
      break;
    case 'purchase':
      for (const field of ['residentId', 'institutionId', 'item', 'quantity']) requireField(field);
      forbidField('expectedAmount');
      forbidField('compensationKind');
      break;
    case 'restock':
      for (const field of ['institutionId', 'item', 'quantity']) requireField(field);
      forbidField('residentId');
      forbidField('expectedAmount');
      forbidField('compensationKind');
      break;
    case 'event-reward':
      requireField('residentId');
      for (const field of [
        'institutionId', 'expectedAmount', 'compensationKind', 'item', 'quantity',
      ]) {
        forbidField(field);
      }
      break;
    case 'event-service':
      for (const field of ['residentId', 'institutionId', 'item', 'quantity']) requireField(field);
      forbidField('expectedAmount');
      forbidField('compensationKind');
      break;
  }
  assertDateTimestamp(entry.createdAt, 'createdAt');
  if (entry.dayKey !== shanghaiEconomyDayKey(entry.createdAt)) {
    throw new Error('dayKey must match createdAt in Asia/Shanghai');
  }
}

async function validateLedgerContract(ctx: EconomyDbContext, entry: EconomyLedgerEntry) {
  switch (entry.kind) {
    case 'work': {
      const account = await requireResidentAccount(ctx, entry);
      const profile = residentProfile(account.profileId);
      const institution = await requireInstitution(ctx, entry);
      if (institution.id !== profile.institutionId) throw new Error('work institution mismatch');
      const expectedOutput = profile.workOutput.kind === 'stock'
        ? profile.workOutput.item
        : profile.workOutput.serviceId;
      if (entry.item !== expectedOutput || entry.quantity !== profile.workOutput.quantity) {
        throw new Error('work output does not match the resident economic profile');
      }
      if (entry.expectedAmount !== profile.compensation.amount) {
        throw new Error('expectedAmount must record the configured compensation attempt');
      }
      if (entry.compensationKind !== profile.compensation.kind) {
        throw new Error('compensationKind must match the resident compensation contract');
      }
      if (entry.amount > entry.expectedAmount) throw new Error('work amount exceeds expectedAmount');
      return;
    }
    case 'purchase': {
      await requireResidentAccount(ctx, entry);
      const institution = await requireInstitution(ctx, entry);
      const good = requireInstitutionGood(institution, entry.item, 'purchase item');
      const total = good.price * entry.quantity;
      if (entry.amount <= 0 || entry.amount !== total) {
        throw new Error('purchase amount must equal the configured price times quantity');
      }
      return;
    }
    case 'event-reward':
      await requireResidentAccount(ctx, entry);
      if (![10, 20, 50].includes(entry.amount)) {
        throw new Error('event reward amount must be an earned configured tier');
      }
      return;
    case 'restock': {
      const institution = await requireInstitution(ctx, entry);
      if (!entry.item) throw new Error('restock item summary is required');
      if (!entry.item.startsWith('{')) {
        requireInstitutionGood(institution, entry.item, 'restock item');
        return;
      }
      const summary = parseCounterJson(entry.item);
      assertCounterRecord(summary, 'restock item summary');
      for (const item of Object.keys(summary)) requireInstitutionGood(
        institution, item, 'restock item',
      );
      const total = Object.values(summary).reduce((sum, value) => sum + value, 0);
      if (total !== entry.quantity) throw new Error('restock quantity must match item summary');
      return;
    }
    case 'event-service': {
      await requireResidentAccount(ctx, entry);
      const institution = await requireInstitution(ctx, entry);
      if (!institution.serviceIds.includes(entry.item as never)) {
        throw new Error('event service must belong to the institution');
      }
      if (entry.amount <= 0) throw new Error('event service amount must be positive');
      return;
    }
    default: {
      const exhaustive: never = entry;
      throw new Error(`Unknown ledger kind: ${String((exhaustive as { kind?: unknown }).kind)}`);
    }
  }
}

async function requireResidentAccount(ctx: EconomyDbContext, entry: EconomyLedgerEntry) {
  if (!entry.residentId) throw new Error(`${entry.kind} requires a resident account`);
  const account = await ctx.db
    .query('residentEconomy')
    .withIndex('resident', (q) =>
      q.eq('worldId', entry.worldId).eq('residentId', entry.residentId),
    )
    .unique();
  if (!account) throw new Error(`${entry.kind} resident account is missing`);
  return account;
}

async function requireInstitution(ctx: EconomyDbContext, entry: EconomyLedgerEntry) {
  if (!entry.institutionId) throw new Error(`${entry.kind} requires an institution`);
  const definition = institutionDefinition(entry.institutionId);
  const persisted = await ctx.db
    .query('townInstitutions')
    .withIndex('institution', (q) =>
      q.eq('worldId', entry.worldId).eq('institutionId', entry.institutionId),
    )
    .unique();
  if (!persisted) throw new Error(`${entry.kind} institution is not initialized`);
  return definition;
}

function requireInstitutionGood(
  institution: InstitutionDefinition,
  item: string | undefined,
  label: string,
) {
  if (!item || !institution.goods.includes(item as GoodId)) {
    throw new Error(`${label} does not belong to the institution`);
  }
  const good = goods.find((candidate) => candidate.id === item);
  if (!good) throw new Error(`${label} is not a known good`);
  return good;
}

function ledgerEntriesEquivalent(
  existing: Record<string, unknown>,
  entry: EconomyLedgerEntry,
) {
  const fields = [
    'worldId', 'idempotencyKey', 'dayKey', 'residentId', 'institutionId', 'kind',
    'amount', 'expectedAmount', 'compensationKind', 'item', 'quantity',
    'sourceKey', 'text', 'createdAt',
  ];
  const equivalent = fields.every(
    (field) => existing[field] === (entry as unknown as Record<string, unknown>)[field],
  );
  if (equivalent) return true;
  // Accept otherwise exact imported legacy work rows missing contract metadata.
  if (existing.kind !== 'work' || entry.kind !== 'work') {
    return false;
  }
  if (
    (existing.expectedAmount !== undefined
      && existing.expectedAmount !== entry.expectedAmount)
    || (existing.compensationKind !== undefined
      && existing.compensationKind !== entry.compensationKind)
  ) {
    return false;
  }
  return fields
    .filter((field) => field !== 'expectedAmount' && field !== 'compensationKind')
    .every(
      (field) => existing[field] === (entry as unknown as Record<string, unknown>)[field],
    );
}

function initialStock(institution: InstitutionDefinition) {
  const stock = Object.fromEntries(
    institution.goods.map((goodId) => [goodId, INITIAL_STOCK[goodId]]),
  );
  assertCounterRecord(stock, `${institution.id}.stock`);
  return stock;
}

function initialServiceCounters(institution: InstitutionDefinition) {
  const counters = Object.fromEntries(
    institution.serviceIds.map((serviceId) => [serviceId, 0]),
  );
  assertCounterRecord(counters, `${institution.id}.services`);
  return counters;
}

function residentProfile(profileId: string): ResidentEconomyProfile {
  const profile = residentEconomyProfiles.find((entry) => entry.id === profileId);
  if (!profile) throw new Error(`Unknown resident economy profile: ${profileId}`);
  return profile;
}

function institutionDefinition(institutionId: string): InstitutionDefinition {
  const institution = institutions.find((entry) => entry.id === institutionId);
  if (!institution) throw new Error(`Unknown town institution: ${institutionId}`);
  return institution;
}

function residentInitializationSource(profileId: string) {
  return `economy-definition:resident:${profileId}:v1`;
}

function institutionInitializationSource(institutionId: string) {
  return `economy-definition:institution:${institutionId}:v1`;
}

function requireAbsent(value: unknown, label: string) {
  if (value !== undefined) throw new Error(`${label} must be absent`);
}

function assertPositiveQuantity(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_STOCK) {
    throw new Error(`${label} must be a positive bounded safe integer`);
  }
}

function assertCounterRecord(record: Record<string, number>, label: string) {
  for (const [key, value] of Object.entries(record)) {
    assertBoundedString(key, 80, `${label}.key`);
    assertBoundedSafeInteger(value, MAX_STOCK, `${label}.${key}`);
  }
}

function assertNonNegativeSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function assertBoundedSafeInteger(value: number, maximum: number, label: string) {
  assertNonNegativeSafeInteger(value, label);
  if (value > maximum) throw new Error(`${label} exceeds the supported maximum`);
}

function isBoundedSafeInteger(value: number, maximum: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function assertDateTimestamp(value: number, label: string) {
  assertNonNegativeSafeInteger(value, label);
  if (value > MAX_SHANGHAI_TIMESTAMP) {
    throw new Error(`${label} exceeds the supported Shanghai calendar range`);
  }
}

function assertCanonicalKey(value: string, label: string) {
  assertBoundedString(value, MAX_LEDGER_KEY_LENGTH, label);
  if (!CANONICAL_KEY.test(value)) {
    throw new Error(`${label} must use canonical lowercase ASCII characters`);
  }
}

function assertBoundedString(value: string, maximum: number, label: string) {
  if (!value.trim() || Array.from(value).length > maximum) {
    throw new Error(`${label} must be nonblank and at most ${maximum} characters`);
  }
}

function assertDayKey(value: string, label: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !DAY_KEY.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${label} must be a valid YYYY-MM-DD value`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
