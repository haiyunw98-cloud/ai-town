import { v } from 'convex/values';
import {
  goods,
  institutions,
  residentEconomyProfiles,
  type GoodId,
  type InstitutionDefinition,
  type ResidentEconomyProfile,
} from '../data/worlds/lighthouse-town/economy';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { MAX_MONEY, MAX_STOCK } from './townEconomyRules';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const STARTING_INSTITUTION_CASH = 120;
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

export type EconomyLedgerEntry = {
  worldId: Id<'worlds'>;
  idempotencyKey: string;
  dayKey: string;
  residentId?: string;
  institutionId?: string;
  kind: EconomyLedgerKind;
  amount: number;
  expectedAmount?: number;
  item?: string;
  quantity?: number;
  sourceKey: string;
  text: string;
  createdAt: number;
};

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
    validatePersistedResident(row, identity.resolvedByProfileId);
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
    validatePersistedInstitution(row);
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
  if (entry.quantity !== undefined) assertPositiveQuantity(entry.quantity, 'quantity');
  assertDateTimestamp(entry.createdAt, 'createdAt');
  if (entry.dayKey !== shanghaiEconomyDayKey(entry.createdAt)) {
    throw new Error('dayKey must match createdAt in Asia/Shanghai');
  }
}

async function validateLedgerContract(ctx: EconomyDbContext, entry: EconomyLedgerEntry) {
  if (entry.kind === 'work') {
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
    if (entry.amount > entry.expectedAmount) throw new Error('work amount exceeds expectedAmount');
    return;
  }
  if (entry.kind === 'purchase') {
    await requireResidentAccount(ctx, entry);
    const institution = await requireInstitution(ctx, entry);
    requireAbsent(entry.expectedAmount, 'purchase expectedAmount');
    const good = requireInstitutionGood(institution, entry.item, 'purchase item');
    const quantity = requireQuantity(entry.quantity, 'purchase quantity');
    const total = good.price * quantity;
    if (entry.amount <= 0 || entry.amount !== total) {
      throw new Error('purchase amount must equal the configured price times quantity');
    }
    return;
  }
  if (entry.kind === 'event-reward') {
    await requireResidentAccount(ctx, entry);
    requireAbsent(entry.institutionId, 'event reward institutionId');
    requireAbsent(entry.item, 'event reward item');
    requireAbsent(entry.quantity, 'event reward quantity');
    requireAbsent(entry.expectedAmount, 'event reward expectedAmount');
    if (![10, 30, 80].includes(entry.amount)) {
      throw new Error('event reward amount must be an earned configured tier');
    }
    return;
  }
  if (entry.kind === 'restock') {
    requireAbsent(entry.residentId, 'restock residentId');
    requireAbsent(entry.expectedAmount, 'restock expectedAmount');
    const institution = await requireInstitution(ctx, entry);
    requireInstitutionGood(institution, entry.item, 'restock item');
    requireQuantity(entry.quantity, 'restock quantity');
    return;
  }
  if (entry.kind === 'event-service') {
    await requireResidentAccount(ctx, entry);
    const institution = await requireInstitution(ctx, entry);
    requireAbsent(entry.expectedAmount, 'event service expectedAmount');
    if (!entry.item || !institution.serviceIds.includes(entry.item as never)) {
      throw new Error('event service must belong to the institution');
    }
    requireQuantity(entry.quantity, 'event service quantity');
    if (entry.amount <= 0) throw new Error('event service amount must be positive');
  }
}

async function requireResidentAccount(ctx: EconomyDbContext, entry: EconomyLedgerEntry) {
  if (!entry.residentId) throw new Error(`${entry.kind} requires a resident account`);
  const account = await ctx.db
    .query('residentEconomy')
    .withIndex('resident', (q) =>
      q.eq('worldId', entry.worldId).eq('residentId', entry.residentId!),
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
      q.eq('worldId', entry.worldId).eq('institutionId', entry.institutionId!),
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
  const fields: Array<keyof EconomyLedgerEntry> = [
    'worldId', 'idempotencyKey', 'dayKey', 'residentId', 'institutionId', 'kind',
    'amount', 'expectedAmount', 'item', 'quantity', 'sourceKey', 'text', 'createdAt',
  ];
  return fields.every((field) => existing[field] === entry[field]);
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

function requireQuantity(quantity: number | undefined, label: string) {
  if (quantity === undefined) throw new Error(`${label} is required`);
  assertPositiveQuantity(quantity, label);
  return quantity;
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

function assertDateTimestamp(value: number, label: string) {
  assertNonNegativeSafeInteger(value, label);
  if (value > MAX_DATE_MS - SHANGHAI_OFFSET_MS) {
    throw new Error(`${label} exceeds the supported Date range`);
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
