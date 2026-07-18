import { v } from 'convex/values';
import {
  institutions,
  residentEconomyProfiles,
  type GoodId,
} from '../data/worlds/lighthouse-town/economy';
import type { Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { MAX_MONEY, MAX_STOCK } from './townEconomyRules';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const STARTING_INSTITUTION_CASH = 120;
const INITIAL_STOCK: Readonly<Record<GoodId, number>> = {
  meal: 12,
  tea: 12,
  medicine: 8,
  'daily-goods': 10,
  'craft-service': 99,
};

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
  item?: string;
  quantity?: number;
  sourceKey: string;
  text: string;
  createdAt: number;
};

export function shanghaiEconomyDayKey(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('createdAt must be a non-negative safe integer');
  }
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export async function initializeTownEconomy(
  ctx: Pick<MutationCtx, 'db'>,
  worldId: Id<'worlds'>,
  now = Date.now(),
) {
  assertNonNegativeSafeInteger(now, 'updatedAt');
  assertBoundedSafeInteger(STARTING_INSTITUTION_CASH, MAX_MONEY, 'institution.cash');
  const dayKey = shanghaiEconomyDayKey(now);
  const runtimeDescriptions = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .collect();
  const descriptionsByName = new Map<string, (typeof runtimeDescriptions)[number]>();
  for (const description of runtimeDescriptions) {
    if (!descriptionsByName.has(description.name)) {
      descriptionsByName.set(description.name, description);
    }
  }

  const existingAccounts = await ctx.db
    .query('residentEconomy')
    .withIndex('world', (q) => q.eq('worldId', worldId))
    .collect();
  const accountResidentIds = new Set(existingAccounts.map((row) => row.residentId));
  const accountProfileIds = new Set(existingAccounts.map((row) => row.profileId));
  const missingResidentNames: string[] = [];
  for (const profile of residentEconomyProfiles) {
    const runtimeDescription = descriptionsByName.get(profile.name);
    if (!runtimeDescription) {
      missingResidentNames.push(profile.name);
      continue;
    }
    if (
      accountResidentIds.has(runtimeDescription.playerId)
      || accountProfileIds.has(profile.id)
    ) {
      continue;
    }
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
      hunger: 100,
      energy: 100,
      todayIncome: 0,
      todayExpense: 0,
      dayKey,
      updatedAt: now,
    });
    accountResidentIds.add(runtimeDescription.playerId);
    accountProfileIds.add(profile.id);
  }

  const existingInstitutions = await ctx.db
    .query('townInstitutions')
    .withIndex('world', (q) => q.eq('worldId', worldId))
    .collect();
  const institutionIds = new Set(existingInstitutions.map((row) => row.institutionId));
  for (const institution of institutions) {
    if (institutionIds.has(institution.id)) continue;
    const stock = Object.fromEntries(
      institution.goods.map((goodId) => [goodId, INITIAL_STOCK[goodId]]),
    );
    const serviceCounters = Object.fromEntries(
      institution.serviceIds.map((serviceId) => [serviceId, 0]),
    );
    assertCounterRecord(stock, `${institution.id}.stock`);
    assertCounterRecord(serviceCounters, `${institution.id}.services`);
    await ctx.db.insert('townInstitutions', {
      worldId,
      institutionId: institution.id,
      cash: STARTING_INSTITUTION_CASH,
      stockJson: JSON.stringify(stock),
      serviceCountersJson: JSON.stringify(serviceCounters),
      todayIncome: 0,
      todayExpense: 0,
      visitorCount: 0,
      dayKey,
      updatedAt: now,
    });
    institutionIds.add(institution.id);
  }

  return {
    residentCount: accountProfileIds.size,
    institutionCount: institutionIds.size,
    missingResidentNames,
  };
}

export async function appendEconomyLedger(
  ctx: Pick<MutationCtx, 'db'>,
  entry: EconomyLedgerEntry,
): Promise<boolean> {
  validateLedgerEntry(entry);
  const existing = await ctx.db
    .query('economyLedger')
    .withIndex('idempotencyKey', (q) =>
      q.eq('worldId', entry.worldId).eq('idempotencyKey', entry.idempotencyKey),
    )
    .unique();
  if (existing) return false;
  await ctx.db.insert('economyLedger', entry);
  return true;
}

export const initializeForWorld = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => initializeTownEconomy(ctx, args.worldId),
});

function validateLedgerEntry(entry: EconomyLedgerEntry) {
  assertNonBlank(entry.idempotencyKey, 'idempotencyKey');
  assertNonBlank(entry.sourceKey, 'sourceKey');
  assertNonBlank(entry.text, 'text');
  if (entry.residentId !== undefined) assertNonBlank(entry.residentId, 'residentId');
  if (entry.institutionId !== undefined) assertNonBlank(entry.institutionId, 'institutionId');
  if (entry.item !== undefined) assertNonBlank(entry.item, 'item');
  assertBoundedSafeInteger(entry.amount, MAX_MONEY, 'amount');
  assertNonNegativeSafeInteger(entry.createdAt, 'createdAt');
  if (entry.quantity !== undefined) {
    if (
      !Number.isSafeInteger(entry.quantity)
      || entry.quantity <= 0
      || entry.quantity > MAX_STOCK
    ) {
      throw new Error('quantity must be a positive safe integer');
    }
  }
  if (entry.dayKey !== shanghaiEconomyDayKey(entry.createdAt)) {
    throw new Error('dayKey must match createdAt in Asia/Shanghai');
  }
}

function assertCounterRecord(record: Record<string, number>, label: string) {
  for (const [key, value] of Object.entries(record)) {
    assertNonBlank(key, `${label}.key`);
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

function assertNonBlank(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} must not be blank`);
}
