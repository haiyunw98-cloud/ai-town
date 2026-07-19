import { v } from 'convex/values';
import { residentEconomyProfiles } from '../data/worlds/lighthouse-town/economy';
import type { Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import {
  BACKGROUND_LIFE_SLOT_MS,
  backgroundLifeActionForSlot,
  backgroundLifeIdempotencyKey,
  backgroundLifeModeForWorldStatus,
  backgroundLifeSlotsToProcess,
  floorBackgroundLifeSlot,
} from './backgroundLifeRules';
import { recordActivityFact } from './lives';
import {
  initializeTownEconomy,
  settleInactiveBackgroundEconomy,
} from './townEconomy';
import {
  initializeTownRelations,
  recordInactiveRelationEvent,
} from './townRelations';

const RULES_VERSION = 1;

type BackgroundContext = Pick<MutationCtx, 'db'>;

export async function advanceBackgroundLife(
  ctx: BackgroundContext,
  now = Date.now(),
) {
  const currentSlot = floorBackgroundLifeSlot(now);
  const statuses = await ctx.db.query('worldStatus').collect();
  let processedSlots = 0;
  let simulatedWorlds = 0;
  let heldWorlds = 0;
  for (const status of statuses) {
    const mode = backgroundLifeModeForWorldStatus(status.status);
    let state = await ctx.db
      .query('backgroundLifeState')
      .withIndex('worldId', (q) => q.eq('worldId', status.worldId))
      .unique();
    if (!state) {
      const initialSlot = mode === 'simulate'
        ? currentSlot - BACKGROUND_LIFE_SLOT_MS
        : currentSlot;
      const stateId = await ctx.db.insert('backgroundLifeState', {
        worldId: status.worldId,
        lastProcessedSlot: initialSlot,
        lastProcessedAt: now,
        rulesVersion: RULES_VERSION,
        lastWorldStatus: status.status,
      });
      state = await ctx.db.get(stateId);
      if (!state) throw new Error('Background life state insertion failed');
    }

    if (mode !== 'simulate') {
      await ctx.db.patch(state._id, {
        lastProcessedSlot: Math.max(state.lastProcessedSlot, currentSlot),
        lastProcessedAt: now,
        rulesVersion: RULES_VERSION,
        lastWorldStatus: status.status,
      });
      if (mode === 'hold-without-catch-up') heldWorlds += 1;
      continue;
    }

    const result = await simulateInactiveWorld(ctx, {
      worldId: status.worldId,
      lastProcessedSlot: state.lastProcessedSlot,
      currentSlot,
      now,
    });
    const lastProcessedSlot = result.lastProcessedSlot ?? state.lastProcessedSlot;
    await ctx.db.patch(state._id, {
      lastProcessedSlot,
      lastProcessedAt: now,
      rulesVersion: RULES_VERSION,
      lastWorldStatus: status.status,
    });
    processedSlots += result.processedSlots;
    simulatedWorlds += 1;
  }
  return { processedSlots, simulatedWorlds, heldWorlds };
}

async function simulateInactiveWorld(
  ctx: BackgroundContext,
  args: {
    worldId: Id<'worlds'>;
    lastProcessedSlot: number;
    currentSlot: number;
    now: number;
  },
) {
  await initializeTownEconomy(ctx, args.worldId, args.currentSlot);
  await initializeTownRelations(ctx, args.worldId, args.currentSlot);
  const accounts = await ctx.db
    .query('residentEconomy')
    .withIndex('world', (q) => q.eq('worldId', args.worldId))
    .collect();
  const byProfile = new Map(accounts.map((account) => [account.profileId, account]));
  const orderedResidents = residentEconomyProfiles.map((profile) => {
    const account = byProfile.get(profile.id);
    if (!account) throw new Error(`Background life resident is missing: ${profile.id}`);
    return { profile, account };
  });
  const slots = backgroundLifeSlotsToProcess(
    args.lastProcessedSlot,
    args.currentSlot,
  );

  if (slots.skippedBefore !== undefined) {
    const first = orderedResidents[0];
    const sourceKey = backgroundLifeIdempotencyKey(
      String(args.worldId),
      slots.skippedBefore,
      `gap-${args.lastProcessedSlot}-${slots.skippedBefore}`,
    );
    await recordActivityFact(ctx, {
      worldId: args.worldId,
      residentId: first.account.residentId,
      kind: 'background-offline-gap',
      text: '设备离线时间超过七天；系统只保留离线空档范围，不虚构更早的逐时生活。',
      createdAt: slots.skippedBefore,
      sourceKey,
    });
  }

  let lastProcessedSlot: number | undefined;
  for (const slot of slots.slots) {
    const action = backgroundLifeActionForSlot(slot, orderedResidents.length);
    const resident = orderedResidents[action.residentIndex];
    const key = backgroundLifeIdempotencyKey(String(args.worldId), slot, action.kind);
    if (action.kind === 'work') {
      await settleInactiveBackgroundEconomy(ctx, {
        worldId: args.worldId,
        residentId: resident.account.residentId,
        slot,
        idempotencyKey: key,
        action: { kind: 'work' },
      });
    } else if (action.kind === 'purchase') {
      const purchase = purchaseForSlot(slot);
      await settleInactiveBackgroundEconomy(ctx, {
        worldId: args.worldId,
        residentId: resident.account.residentId,
        slot,
        idempotencyKey: key,
        action: { kind: 'purchase', ...purchase },
      });
    } else if (action.kind === 'social') {
      const partner = orderedResidents[action.partnerIndex!];
      const relationKind = Math.floor(slot / BACKGROUND_LIFE_SLOT_MS) % 3 === 0
        ? 'care' as const
        : 'cooperation' as const;
      const text = relationKind === 'care'
        ? `${resident.profile.name}在日常生活中关照了${partner.profile.name}。`
        : `${resident.profile.name}与${partner.profile.name}处理了一件普通邻里事务。`;
      await recordInactiveRelationEvent(ctx, {
        worldId: args.worldId,
        idempotencyKey: `${key}:relation`,
        residentA: resident.account.residentId,
        residentB: partner.account.residentId,
        kind: relationKind,
        sourceKey: key,
        text,
        createdAt: slot,
      });
      await recordActivityFact(ctx, {
        worldId: args.worldId,
        residentId: resident.account.residentId,
        kind: 'background-social',
        text,
        createdAt: slot,
        sourceKey: `${key}:life`,
        category: 'social',
      });
    } else {
      await recordActivityFact(ctx, {
        worldId: args.worldId,
        residentId: resident.account.residentId,
        kind: 'background-rest',
        text: `${resident.profile.name}结束当日事务，按自己的作息休息。`,
        createdAt: slot,
        sourceKey: `${key}:life`,
        category: 'care',
      });
    }
    lastProcessedSlot = slot;
  }
  return { processedSlots: slots.slots.length, lastProcessedSlot, hasMore: slots.hasMore };
}

function purchaseForSlot(slot: number) {
  const shanghaiHour = new Date(slot + 8 * 60 * 60 * 1_000).getUTCHours();
  if (shanghaiHour >= 14 && shanghaiHour < 18) {
    return { institutionId: 'tea-house', goodId: 'tea' as const };
  }
  if (shanghaiHour >= 18) {
    return { institutionId: 'morning-market', goodId: 'meal' as const };
  }
  return { institutionId: 'restaurant', goodId: 'meal' as const };
}

export const advanceBackgroundLifeTick = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: (ctx, args) => advanceBackgroundLife(ctx, args.now ?? Date.now()),
});
