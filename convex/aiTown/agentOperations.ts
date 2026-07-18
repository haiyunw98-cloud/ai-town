import { v } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { WorldMap, serializedWorldMap } from './worldMap';
import { rememberConversation } from '../agent/memory';
import { GameId, agentId, conversationId, playerId } from './ids';
import {
  continueConversationMessage,
  leaveConversationMessage,
  startConversationMessage,
} from '../agent/conversation';
import { assertNever } from '../util/assertNever';
import { serializedAgent } from './agent';
import {
  ACTIVITY_COOLDOWN,
  CONVERSATION_COOLDOWN,
  PLAYER_CONVERSATION_COOLDOWN,
} from '../constants';
import { internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { serializedPlayer } from './player';
import {
  ACTIVITY_CATEGORIES,
  feasibleActivitiesForState,
  type EconomicAction,
  type FeasibleActivityView,
  type ResidentActivity,
} from '../../data/worlds/lighthouse-town/activities';
import { insertInput } from './insertInput';
import { distance } from '../util/geometry';
import {
  townLandmarkById,
  type TownLandmarkId,
} from '../../data/worlds/lighthouse-town/map';
import {
  ReplyContext,
  ReplyRejectionReason,
  validateResidentReply,
} from '../agent/conversationPolicy';
import { getWorldLocale } from '../util/worldLocale';
import { settleActivity, validateActivityRegistration } from '../townEconomy';
import { recordActivityFact } from '../lives';
import type { Id } from '../_generated/dataModel';
import { localChatCompletionOnce } from '../util/llm';

const economicActionValidator = v.union(
  v.object({
    kind: v.literal('work'),
    institutionId: v.string(),
    output: v.union(
      v.object({ kind: v.literal('stock'), item: v.string(), quantity: v.number() }),
      v.object({ kind: v.literal('service'), serviceId: v.string(), quantity: v.number() }),
    ),
  }),
  v.object({
    kind: v.literal('purchase'),
    institutionId: v.string(),
    goodId: v.string(),
    quantity: v.literal(1),
  }),
  v.object({ kind: v.literal('rest') }),
);
const activityCategoryValidator = v.union(
  ...ACTIVITY_CATEGORIES.map((category) => v.literal(category)),
);
const SETTLEMENT_RETRY_MS = 2_000;
const SETTLEMENT_ARRIVAL_GRACE_MS = 8_000;
const SETTLEMENT_PROGRESS_GRACE_MS = 5 * 60_000;
const PAUSED_SETTLEMENT_RETRY_DELAYS = [60_000, 300_000, 1_800_000, 3_600_000] as const;

type ActivityChoiceView = Pick<FeasibleActivityView, 'needs' | 'criticalNeeds' | 'state'> & {
  activities: ReadonlyArray<Pick<ResidentActivity, 'category' | 'description'>>;
};

export function buildResidentActivityChoicePrompt(
  residentName: string,
  view: ActivityChoiceView,
) {
  const choices = view.activities.map(
    (activity, index) => `[${index}] ${activity.category}: ${activity.description}`,
  );
  return [
    `Resident=${residentName}`,
    `State: hunger=${view.state.hunger}, energy=${view.state.energy}, balance=${view.state.balance}`,
    `Context: needs=${view.needs.join(',') || 'none'}, critical=${view.criticalNeeds.join(',') || 'none'}`,
    'Choose one plausible next activity from the finite options below.',
    ...choices,
    'Return only the option index.',
  ].join('\n');
}

export async function chooseResidentActivityWithLocalModel(
  residentName: string,
  view: FeasibleActivityView,
  dependencies: {
    complete?: typeof localChatCompletionOnce;
    random?: () => number;
    isWorldRunning?: () => Promise<boolean>;
  } = {},
): Promise<ResidentActivity | null> {
  if (view.activities.length === 0) {
    throw new Error(`No feasible resident activities: ${residentName}`);
  }
  if (dependencies.isWorldRunning && !await dependencies.isWorldRunning()) return null;
  try {
    const completion = await (dependencies.complete ?? localChatCompletionOnce)({
      model: 'gemma4:12b',
      messages: [{
        role: 'user',
        content: buildResidentActivityChoicePrompt(residentName, view),
      }],
      temperature: 0.2,
      max_tokens: 8,
    });
    const match = completion.content.trim().match(/^\[?(\d+)\]?\.?$/u);
    const index = match ? Number(match[1]) : -1;
    if (Number.isSafeInteger(index) && index >= 0 && index < view.activities.length) {
      return view.activities[index];
    }
  } catch {
    // A local model outage may use the bounded in-process choice below, never a cloud fallback.
  }
  const criticalCategories = new Set<ResidentActivity['category']>(
    view.criticalNeeds.map((need) => need === 'food' ? 'food' : 'care'),
  );
  const critical = view.activities.filter((activity) =>
    criticalCategories.has(activity.category),
  );
  const candidates = critical.length > 0 ? critical : view.activities;
  const random = dependencies.random ?? Math.random;
  const index = Math.min(Math.floor(random() * candidates.length), candidates.length - 1);
  return candidates[index];
}

export async function generateValidatedResidentMessage(
  args: { kind: ReplyContext['kind']; locale: NonNullable<ReplyContext['locale']> },
  dependencies: {
    generate: () => Promise<string>;
    loadPolicyContext: () => Promise<Pick<ReplyContext, 'topic' | 'observerAskedAboutSea'>>;
    send: (validatedText: string) => Promise<unknown>;
    recordRejection: (reason: ReplyRejectionReason) => Promise<unknown>;
    reportGenerationUnavailable?: () => void;
    reportMetricUnavailable?: (reason: ReplyRejectionReason) => void;
  },
): Promise<void> {
  let raw = '';
  try {
    raw = await dependencies.generate();
  } catch {
    dependencies.reportGenerationUnavailable?.();
  }
  const policyContext = await dependencies.loadPolicyContext();
  const validation = validateResidentReply(raw, {
    kind: args.kind,
    locale: args.locale,
    ...policyContext,
  });
  await dependencies.send(validation.text);
  if (!validation.accepted) {
    try {
      await dependencies.recordRejection(validation.reason);
    } catch {
      dependencies.reportMetricUnavailable?.(validation.reason);
    }
  }
}

export async function rememberConversationAndRelease(dependencies: {
  remember: () => Promise<unknown>;
  release: () => Promise<void>;
}): Promise<void> {
  try {
    await dependencies.remember();
  } finally {
    await dependencies.release();
  }
}

export async function runAgentOperation(ctx: MutationCtx, operation: string, args: any) {
  let reference;
  switch (operation) {
    case 'agentRememberConversation':
      reference = internal.aiTown.agentOperations.agentRememberConversation;
      break;
    case 'agentGenerateMessage':
      reference = internal.aiTown.agentOperations.agentGenerateMessage;
      break;
    case 'agentDoSomething':
      reference = internal.aiTown.agentOperations.agentDoSomething;
      break;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
  // The engine persists pending operation payloads with v.any(); each scheduled
  // internal function validates its own arguments at the Convex boundary.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  await ctx.scheduler.runAfter(0, reference, args);
}

export const agentSendMessage = internalMutation({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    agentId,
    playerId,
    validatedText: v.string(),
    messageUuid: v.string(),
    leaveConversation: v.boolean(),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.playerId,
      text: args.validatedText,
      messageUuid: args.messageUuid,
      worldId: args.worldId,
    });
    await insertInput(ctx, args.worldId, 'agentFinishSendingMessage', {
      conversationId: args.conversationId,
      agentId: args.agentId,
      timestamp: Date.now(),
      leaveConversation: args.leaveConversation,
      operationId: args.operationId,
    });
  },
});

export const recordConversationPolicyEvent = internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId,
    conversationId,
    reason: v.union(
      v.literal('world-correction'),
      v.literal('empty'),
      v.literal('legacy-story'),
      v.literal('too-long'),
    ),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('conversationPolicyEvents', args);
  },
});

export const settleResidentActivity = internalMutation({
  args: {
    worldId: v.id('worlds'),
    residentId: playerId,
    operationId: v.string(),
    activityText: v.string(),
    activityUntil: v.number(),
    landmarkId: v.string(),
    category: activityCategoryValidator,
    economicAction: economicActionValidator,
    arrivalGraceStartedAt: v.optional(v.number()),
    arrivalRecoveryDeadline: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    pauseRetryCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const {
      arrivalGraceStartedAt,
      arrivalRecoveryDeadline,
      lastAttemptAt,
      pauseRetryCount,
      ...settlementArgs
    } = args;
    const result = await settleActivity(
      ctx,
      settlementArgs as Parameters<typeof settleActivity>[1],
    );
    const next = nextActivitySettlementAttempt(result, {
      activityUntil: args.activityUntil,
      arrivalGraceStartedAt,
      arrivalRecoveryDeadline,
      lastAttemptAt,
      pauseRetryCount,
    }, now);
    if (next?.kind === 'retry' || next?.kind === 'paused-outstanding') {
      await persistActivitySettlementRetryState(ctx, {
        worldId: args.worldId,
        operationId: args.operationId,
        arrivalGraceStartedAt: next.arrivalGraceStartedAt,
        arrivalRecoveryDeadline: next.arrivalRecoveryDeadline,
        lastAttemptAt: next.lastAttemptAt,
        pauseRetryCount: next.pauseRetryCount,
      });
    }
    if (next?.kind === 'retry') {
      await ctx.scheduler.runAfter(
        next.delay,
        internal.aiTown.agentOperations.settleResidentActivity,
        {
          ...args,
          arrivalGraceStartedAt: next.arrivalGraceStartedAt,
          arrivalRecoveryDeadline: next.arrivalRecoveryDeadline,
          lastAttemptAt: next.lastAttemptAt,
          pauseRetryCount: next.pauseRetryCount,
        },
      );
    } else if (next?.kind === 'terminal-failure') {
      return settleActivity(ctx, {
        ...settlementArgs,
        terminalFailureReason: 'destination-not-reached',
      } as Parameters<typeof settleActivity>[1]);
    }
    return result;
  },
});

export function nextActivitySettlementAttempt(
  result: { status: string; destinationProgressing?: boolean },
  args: {
    activityUntil: number;
    arrivalGraceStartedAt?: number;
    arrivalRecoveryDeadline?: number;
    lastAttemptAt?: number;
    pauseRetryCount?: number;
  },
  now: number,
) {
  if (result.status === 'world-not-running') {
    const pausedElapsed = Math.max(0, now - (args.lastAttemptAt ?? now));
    const pauseRetryCount = Number.isSafeInteger(args.pauseRetryCount)
      ? Math.max(0, args.pauseRetryCount ?? 0)
      : 0;
    const pauseState = {
      arrivalGraceStartedAt: args.arrivalGraceStartedAt === undefined
        ? undefined
        : args.arrivalGraceStartedAt + pausedElapsed,
      ...(args.arrivalRecoveryDeadline !== undefined
        ? { arrivalRecoveryDeadline: args.arrivalRecoveryDeadline + pausedElapsed }
        : {}),
      lastAttemptAt: now,
      pauseRetryCount: Math.min(pauseRetryCount + 1, PAUSED_SETTLEMENT_RETRY_DELAYS.length),
    };
    const delay = PAUSED_SETTLEMENT_RETRY_DELAYS[pauseRetryCount];
    return delay === undefined
      ? { kind: 'paused-outstanding' as const, ...pauseState }
      : { kind: 'retry' as const, delay, ...pauseState };
  }
  if (result.status === 'activity-not-complete') {
    return {
      kind: 'retry' as const,
      delay: Math.max(0, args.activityUntil - now),
      arrivalGraceStartedAt: args.arrivalGraceStartedAt,
      ...(args.arrivalRecoveryDeadline !== undefined
        ? { arrivalRecoveryDeadline: args.arrivalRecoveryDeadline }
        : {}),
      lastAttemptAt: now,
      pauseRetryCount: 0,
    };
  }
  if (result.status !== 'destination-not-reached') return undefined;
  const arrivalGraceStartedAt = args.arrivalGraceStartedAt ?? now;
  const arrivalRecoveryDeadline = args.arrivalRecoveryDeadline
    ?? (result.destinationProgressing ? now + SETTLEMENT_PROGRESS_GRACE_MS : undefined);
  if (
    arrivalRecoveryDeadline !== undefined
      ? now >= arrivalRecoveryDeadline
      : now >= arrivalGraceStartedAt + SETTLEMENT_ARRIVAL_GRACE_MS
  ) {
    return { kind: 'terminal-failure' as const };
  }
  return {
    kind: 'retry' as const,
    delay: SETTLEMENT_RETRY_MS,
    arrivalGraceStartedAt,
    ...(arrivalRecoveryDeadline !== undefined ? { arrivalRecoveryDeadline } : {}),
    lastAttemptAt: now,
    pauseRetryCount: 0,
  };
}

type SettlementRetryState = {
  worldId: Id<'worlds'>;
  operationId: string;
  arrivalGraceStartedAt?: number;
  arrivalRecoveryDeadline?: number;
  lastAttemptAt: number;
  pauseRetryCount: number;
};

export async function persistActivitySettlementRetryState(
  ctx: Pick<MutationCtx, 'db'>,
  args: SettlementRetryState,
) {
  const registration = await ctx.db
    .query('activityRegistrations')
    .withIndex('operation', (q) =>
      q.eq('worldId', args.worldId).eq('operationId', args.operationId),
    )
    .unique();
  if (!registration || registration.state !== 'activated') {
    return { status: 'ignored' as const };
  }
  if (
    registration.settlementLastAttemptAt !== undefined
    && registration.settlementLastAttemptAt > args.lastAttemptAt
  ) {
    return { status: 'stale' as const };
  }
  await ctx.db.patch(registration._id, {
    settlementArrivalGraceStartedAt: args.arrivalGraceStartedAt,
    settlementArrivalRecoveryDeadline: args.arrivalRecoveryDeadline,
    settlementLastAttemptAt: args.lastAttemptAt,
    settlementPauseRetryCount: args.pauseRetryCount,
    updatedAt: Math.max(registration.updatedAt, args.lastAttemptAt),
  });
  return { status: 'persisted' as const };
}

export const wakeOutstandingActivitySettlementsMutation = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: (ctx, args) => wakeOutstandingActivitySettlements(ctx, args),
});

export async function wakeOutstandingActivitySettlements(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  args: { worldId: Id<'worlds'>; now?: number },
) {
  const now = args.now ?? Date.now();
  const registrations = await ctx.db
    .query('activityRegistrations')
    .withIndex('worldState', (q) =>
      q.eq('worldId', args.worldId).eq('state', 'activated'),
    )
    .order('desc')
    .take(16);
  let scheduled = 0;
  for (const registration of registrations) {
    if (registration.activityUntil === undefined || !registration.economicActionJson) continue;
    if (
      registration.settlementWakeScheduledAt !== undefined
      && registration.settlementWakeScheduledAt >= now - 60_000
      && registration.settlementWakeScheduledAt
        >= (registration.settlementLastAttemptAt ?? registration.activatedAt ?? 0)
    ) {
      continue;
    }
    const [complete, failed] = await Promise.all(['complete', 'failed'].map((phase) =>
      ctx.db
        .query('lifeEvents')
        .withIndex('sourceKey', (q) =>
          q.eq('worldId', registration.worldId)
            .eq('sourceKey', `activity:${registration.operationId}:${phase}`),
        )
        .unique(),
    ));
    if (complete || failed) continue;
    const pausedElapsed = Math.max(
      0,
      now - (registration.settlementLastAttemptAt ?? now),
    );
    const arrivalGraceStartedAt = registration.settlementArrivalGraceStartedAt === undefined
      ? undefined
      : registration.settlementArrivalGraceStartedAt + pausedElapsed;
    const arrivalRecoveryDeadline = registration.settlementArrivalRecoveryDeadline === undefined
      ? undefined
      : registration.settlementArrivalRecoveryDeadline + pausedElapsed;
    let economicAction: EconomicAction;
    try {
      economicAction = JSON.parse(registration.economicActionJson) as EconomicAction;
      validateActivityRegistration({
        worldId: registration.worldId,
        residentId: registration.residentId,
        operationId: registration.operationId,
        activityText: registration.activityText,
        activityUntil: registration.activityUntil,
        landmarkId: registration.landmarkId as TownLandmarkId,
        category: registration.category as ActivityIntentArgs['category'],
        economicAction,
      }, registration.activatedAt ?? registration.startedAt);
    } catch {
      continue;
    }
    await ctx.scheduler.runAfter(
      Math.max(0, registration.activityUntil - now),
      internal.aiTown.agentOperations.settleResidentActivity,
      {
        worldId: registration.worldId,
        residentId: registration.residentId,
        operationId: registration.operationId,
        activityText: registration.activityText,
        activityUntil: registration.activityUntil,
        landmarkId: registration.landmarkId,
        category: registration.category as ActivityIntentArgs['category'],
        economicAction,
        arrivalGraceStartedAt,
        arrivalRecoveryDeadline,
        lastAttemptAt: now,
        pauseRetryCount: 0,
      },
    );
    await ctx.db.patch(registration._id, {
      settlementArrivalGraceStartedAt: arrivalGraceStartedAt,
      settlementArrivalRecoveryDeadline: arrivalRecoveryDeadline,
      settlementLastAttemptAt: now,
      settlementPauseRetryCount: 0,
      settlementWakeScheduledAt: now,
      updatedAt: Math.max(registration.updatedAt, now),
    });
    scheduled += 1;
  }
  return { scheduled };
}

type ActivityIntentArgs = {
  worldId: Id<'worlds'>;
  residentId: string;
  operationId: string;
  activityText: string;
  landmarkId: TownLandmarkId;
  category: ResidentActivity['category'];
  economicAction?: EconomicAction;
  activityDuration: number;
  startedAt: number;
  agentId: string;
  destination: { x: number; y: number };
  emoji?: string;
};

export const enqueueResidentActivity = internalMutation({
  args: {
    worldId: v.id('worlds'),
    residentId: playerId,
    agentId,
    operationId: v.string(),
    activityText: v.string(),
    activityDuration: v.number(),
    landmarkId: v.string(),
    category: activityCategoryValidator,
    economicAction: v.optional(economicActionValidator),
    startedAt: v.number(),
    destination: v.object({ x: v.number(), y: v.number() }),
    emoji: v.optional(v.string()),
  },
  handler: (ctx, args) => enqueueResidentActivityInput(ctx, args as ActivityIntentArgs),
});

export async function enqueueResidentActivityInput(
  ctx: MutationCtx,
  args: ActivityIntentArgs,
) {
  const worldStatus = await ctx.db
    .query('worldStatus')
    .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
    .unique();
  if (!worldStatus || worldStatus.status !== 'running') {
    return { status: 'world-not-running' as const };
  }
  const { startedAt, activityDuration, agentId: registeredAgentId, ...activityArgs } = args;
  if (
    !Number.isSafeInteger(activityDuration)
    || activityDuration <= 0
    || activityDuration > 86_400_000
  ) {
    throw new Error('activityDuration must be a positive bounded integer');
  }
  if (activityArgs.economicAction) {
    validateActivityRegistration({
      worldId: activityArgs.worldId,
      residentId: activityArgs.residentId,
      operationId: activityArgs.operationId,
      activityText: activityArgs.activityText,
      activityUntil: startedAt + activityDuration,
      landmarkId: activityArgs.landmarkId,
      category: activityArgs.category,
      economicAction: activityArgs.economicAction,
    }, startedAt);
  } else {
    if (activityArgs.category !== 'social' && activityArgs.category !== 'leisure') {
      throw new Error('nonfinancial activity category mismatch');
    }
    townLandmarkById(activityArgs.landmarkId);
  }
  const economicActionJson = args.economicAction
    ? JSON.stringify(args.economicAction)
    : undefined;
  const existing = await ctx.db
    .query('activityRegistrations')
    .withIndex('operation', (q) =>
      q.eq('worldId', args.worldId).eq('operationId', args.operationId),
    )
    .unique();
  if (existing) {
    const equivalent = existing.residentId === args.residentId
      && existing.agentId === registeredAgentId
      && existing.activityText === args.activityText
      && existing.activityDuration === args.activityDuration
      && existing.landmarkId === args.landmarkId
      && existing.category === args.category
      && existing.economicActionJson === economicActionJson
      && existing.startedAt === startedAt;
    if (!equivalent || !existing.inputId) {
      throw new Error(`activity registration collision: ${args.operationId}`);
    }
    return {
      status: 'already-queued' as const,
      registrationId: existing._id,
      inputId: existing.inputId,
    };
  }
  const registrationId = await ctx.db.insert('activityRegistrations', {
    worldId: args.worldId,
    residentId: args.residentId,
    agentId: registeredAgentId,
    operationId: args.operationId,
    activityText: args.activityText,
    activityDuration: args.activityDuration,
    landmarkId: args.landmarkId,
    category: args.category,
    ...(economicActionJson ? { economicActionJson } : {}),
    startedAt,
    state: 'intent',
    deliveryState: 'queued',
    recoveryAttempts: 0,
    updatedAt: startedAt,
  });
  const inputId = await insertInput(ctx, args.worldId, 'finishDoSomething', {
    operationId: args.operationId,
    agentId: registeredAgentId as never,
    destination: args.destination,
    activity: {
      description: args.activityText,
      ...(args.emoji ? { emoji: args.emoji } : {}),
      until: startedAt + activityDuration,
    },
    activityDuration,
    activityRegistrationId: registrationId,
  });
  await ctx.db.patch(registrationId, { inputId });
  return { status: 'queued' as const, registrationId, inputId };
}

type ActivityRegistrationAck = {
  worldId: Id<'worlds'>;
  inputId: Id<'inputs'>;
  registrationId: Id<'activityRegistrations'>;
  operationId: string;
  agentId: string;
  residentId: string;
} & (
  | { status: 'activated'; activatedAt: number; activityUntil: number }
  | { status: 'rejected'; acknowledgedAt: number; reason: 'operation-replaced' }
);

async function applyActivityRegistrationAckAtomically(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  args: ActivityRegistrationAck,
) {
  const registration = await ctx.db.get(args.registrationId);
  if (
    !registration
    || registration.worldId !== args.worldId
    || registration.inputId !== args.inputId
    || registration.operationId !== args.operationId
    || registration.agentId !== args.agentId
    || registration.residentId !== args.residentId
  ) {
    return { status: 'ignored' as const, reason: 'unmatched-registration' as const };
  }
  if (args.status === 'rejected') {
    if (registration.state === 'activated') {
      return { status: 'ignored' as const, reason: 'terminal-registration' as const };
    }
    if (registration.state === 'abandoned') return { status: 'already-abandoned' as const };
    await ctx.db.patch(registration._id, {
      state: 'abandoned',
      deliveryState: 'failed',
      abandonReason: args.reason,
      updatedAt: args.acknowledgedAt,
    });
    return { status: 'abandoned' as const };
  }
  if (
    registration.state === 'abandoned'
    || args.activityUntil - args.activatedAt !== registration.activityDuration
    || !Number.isSafeInteger(args.activityUntil)
    || !Number.isSafeInteger(args.activatedAt)
  ) {
    return { status: 'ignored' as const, reason: 'invalid-activation' as const };
  }
  if (registration.state === 'activated') {
    return registration.activatedAt === args.activatedAt
      && registration.activityUntil === args.activityUntil
      ? { status: 'already-activated' as const }
      : { status: 'ignored' as const, reason: 'terminal-registration' as const };
  }
  const economicAction = registration.economicActionJson
    ? JSON.parse(registration.economicActionJson) as EconomicAction
    : undefined;
  const settlementArgs = economicAction ? {
    worldId: registration.worldId,
    residentId: registration.residentId,
    operationId: registration.operationId,
    activityText: registration.activityText,
    activityUntil: args.activityUntil,
    landmarkId: registration.landmarkId as TownLandmarkId,
    category: registration.category as ActivityIntentArgs['category'],
    economicAction,
    lastAttemptAt: args.activityUntil,
    pauseRetryCount: 0,
  } : undefined;
  if (settlementArgs) validateActivityRegistration(settlementArgs, args.activatedAt);
  await recordActivityFact(ctx, {
    worldId: registration.worldId,
    residentId: registration.residentId,
    kind: registration.category,
    text: `开始${registration.activityText}`,
    createdAt: args.activatedAt,
    sourceKey: `activity:${registration.operationId}:start`,
    operationId: registration.operationId,
    phase: 'start',
    category: registration.category,
    landmarkId: registration.landmarkId,
    ...(registration.economicActionJson
      ? { economicActionJson: registration.economicActionJson }
      : {}),
    activityUntil: args.activityUntil,
  });
  await ctx.db.patch(registration._id, {
    state: 'activated',
    deliveryState: 'processed',
    activatedAt: args.activatedAt,
    activityUntil: args.activityUntil,
    updatedAt: args.activatedAt,
  });
  if (settlementArgs) {
    await ctx.scheduler.runAfter(
      registration.activityDuration,
      internal.aiTown.agentOperations.settleResidentActivity,
      settlementArgs,
    );
  }
  return { status: 'activated' as const };
}

export async function applyCompletedActivityRegistrationAcks(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  worldId: Id<'worlds'>,
  completedInputs: Array<{
    inputId: Id<'inputs'>;
    returnValue: { kind: string; value?: unknown; message?: string };
  }>,
) {
  const results = [];
  for (const completed of completedInputs) {
    const input = await ctx.db.get(completed.inputId);
    const registrationId = input?.name === 'finishDoSomething'
      && input.args && typeof input.args === 'object'
      ? (input.args as { activityRegistrationId?: unknown }).activityRegistrationId
      : undefined;
    if (typeof registrationId !== 'string') continue;
    const registration = await ctx.db.get(registrationId as Id<'activityRegistrations'>);
    if (
      !registration
      || registration.worldId !== worldId
      || registration.inputId !== completed.inputId
    ) {
      results.push({ status: 'ignored' as const, reason: 'unmatched-registration' as const });
      continue;
    }
    let ackKind: 'activated' | 'rejected' | 'engine-error' | 'invalid-ack';
    let payload: Record<string, unknown>;
    if (completed.returnValue.kind === 'error') {
      ackKind = 'engine-error';
      payload = {
        message: typeof completed.returnValue.message === 'string'
          ? completed.returnValue.message.slice(0, 240)
          : 'engine-input-error',
      };
    } else {
      const value = completed.returnValue.value;
      const container = value && typeof value === 'object'
        ? value as { activityRegistration?: unknown }
        : undefined;
      const ack = container?.activityRegistration;
      if (!container) {
        ackKind = 'invalid-ack';
        payload = { reason: 'malformed-ack' };
      } else if (!Object.prototype.hasOwnProperty.call(container, 'activityRegistration')) {
        ackKind = 'invalid-ack';
        payload = { reason: 'missing-ack' };
      } else if (!ack || typeof ack !== 'object') {
        ackKind = 'invalid-ack';
        payload = { reason: 'malformed-ack' };
      } else if (
        (ack as Record<string, unknown>).registrationId !== registration._id
        || (ack as Record<string, unknown>).operationId !== registration.operationId
        || (ack as Record<string, unknown>).agentId !== registration.agentId
        || (ack as Record<string, unknown>).residentId !== registration.residentId
      ) {
        ackKind = 'invalid-ack';
        payload = { reason: 'mismatched-ack' };
      } else if (
        (ack as Record<string, unknown>).status === 'activated'
        && typeof (ack as Record<string, unknown>).activatedAt === 'number'
        && typeof (ack as Record<string, unknown>).activityUntil === 'number'
      ) {
        const candidate = ack as Record<string, unknown>;
        ackKind = 'activated';
        payload = {
          activatedAt: candidate.activatedAt,
          activityUntil: candidate.activityUntil,
        };
      } else if (
        (ack as Record<string, unknown>).status === 'rejected'
        && (ack as Record<string, unknown>).reason === 'operation-replaced'
        && typeof (ack as Record<string, unknown>).acknowledgedAt === 'number'
      ) {
        const candidate = ack as Record<string, unknown>;
        ackKind = 'rejected';
        payload = { acknowledgedAt: candidate.acknowledgedAt };
      } else {
        ackKind = 'invalid-ack';
        payload = { reason: 'malformed-ack' };
      }
    }
    const existing = await ctx.db
      .query('activityRegistrationAcks')
      .withIndex('input', (q) => q.eq('worldId', worldId).eq('inputId', completed.inputId))
      .unique();
    if (existing) {
      results.push({ status: 'already-persisted' as const, outboxId: existing._id });
      continue;
    }
    const persistedAt = Date.now();
    const outboxId = await ctx.db.insert('activityRegistrationAcks', {
      worldId,
      inputId: completed.inputId,
      registrationId: registration._id,
      ackKind,
      payloadJson: JSON.stringify(payload),
      status: 'pending',
      attempts: 0,
      createdAt: persistedAt,
      updatedAt: persistedAt,
    });
    await ctx.db.patch(registration._id, {
      deliveryState: 'processing',
      updatedAt: persistedAt,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.aiTown.agentOperations.dispatchActivityRegistrationAck,
      { outboxId },
    );
    results.push({ status: 'persisted' as const, outboxId });
  }
  return results;
}

export const dispatchActivityRegistrationAck = internalAction({
  args: { outboxId: v.id('activityRegistrationAcks') },
  handler: async (ctx, args) => {
    await dispatchActivityRegistrationAckWithRecovery({
      process: () => ctx.runMutation(
        internal.aiTown.agentOperations.processActivityRegistrationAck,
        args,
      ),
      recordFailure: () => ctx.runMutation(
        internal.aiTown.agentOperations.recordActivityRegistrationAckFailureMutation,
        { ...args, errorCode: 'ack-processing-failed' },
      ),
    });
  },
});

export async function dispatchActivityRegistrationAckWithRecovery(dependencies: {
  process: () => Promise<unknown>;
  recordFailure: () => Promise<unknown>;
}) {
  try {
    return await dependencies.process();
  } catch {
    return dependencies.recordFailure();
  }
}

export const processActivityRegistrationAck = internalMutation({
  args: { outboxId: v.id('activityRegistrationAcks') },
  handler: (ctx, args) => processActivityRegistrationAckOutbox(ctx, args),
});

export const recordActivityRegistrationAckFailureMutation = internalMutation({
  args: {
    outboxId: v.id('activityRegistrationAcks'),
    errorCode: v.string(),
  },
  handler: (ctx, args) => recordActivityRegistrationAckFailure(ctx, args),
});

export async function recordActivityRegistrationAckFailure(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  args: { outboxId: Id<'activityRegistrationAcks'>; errorCode: string },
) {
  const outbox = await ctx.db.get(args.outboxId);
  if (!outbox) return { status: 'missing' as const };
  if (outbox.status === 'processed') return { status: 'already-processed' as const };
  if (outbox.status === 'dead-letter') return { status: 'dead-letter' as const };
  const attempts = outbox.attempts + 1;
  const errorCode = 'ack-processing-failed';
  const updatedAt = Date.now();
  const registration = await ctx.db.get(outbox.registrationId);
  if (attempts >= 3) {
    await ctx.db.patch(outbox._id, {
      status: 'dead-letter',
      attempts,
      errorCode,
      updatedAt,
    });
    if (
      registration
      && registration.worldId === outbox.worldId
      && registration.inputId === outbox.inputId
      && registration.state === 'intent'
    ) {
      await ctx.db.patch(registration._id, {
        state: 'abandoned',
        deliveryState: 'failed',
        abandonReason: 'ack-processing-failed',
        recoveryAttempts: attempts,
        updatedAt,
      });
    }
    return { status: 'dead-letter' as const, attempts };
  }
  const delay = Math.min(30_000, 2_000 * (2 ** (attempts - 1)));
  await ctx.db.patch(outbox._id, {
    status: 'retrying',
    attempts,
    errorCode,
    updatedAt,
  });
  if (
    registration
    && registration.worldId === outbox.worldId
    && registration.inputId === outbox.inputId
    && registration.state === 'intent'
  ) {
    await ctx.db.patch(registration._id, {
      deliveryState: 'processing',
      recoveryAttempts: attempts,
      updatedAt,
    });
  }
  await ctx.scheduler.runAfter(
    delay,
    internal.aiTown.agentOperations.dispatchActivityRegistrationAck,
    { outboxId: outbox._id },
  );
  return { status: 'retrying' as const, attempts, delay };
}

export async function processActivityRegistrationAckOutbox(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  args: { outboxId: Id<'activityRegistrationAcks'> },
) {
  const outbox = await ctx.db.get(args.outboxId);
  if (!outbox) return { status: 'missing' as const };
  if (outbox.status === 'processed') return { status: 'already-processed' as const };
  if (outbox.status === 'dead-letter') return { status: 'dead-letter' as const };
  const registration = await ctx.db.get(outbox.registrationId);
  if (
    !registration
    || registration.worldId !== outbox.worldId
    || registration.inputId !== outbox.inputId
  ) {
    throw new Error('ack-outbox-registration-mismatch');
  }
  const payload = JSON.parse(outbox.payloadJson) as Record<string, unknown>;
  let result;
  if (outbox.ackKind === 'activated') {
    if (
      typeof payload.activatedAt !== 'number'
      || typeof payload.activityUntil !== 'number'
    ) {
      throw new Error('ack-outbox-invalid-activation');
    }
    result = await applyActivityRegistrationAckAtomically(ctx, {
      worldId: outbox.worldId,
      inputId: outbox.inputId,
      registrationId: registration._id,
      operationId: registration.operationId,
      agentId: registration.agentId,
      residentId: registration.residentId,
      status: 'activated',
      activatedAt: payload.activatedAt,
      activityUntil: payload.activityUntil,
    });
  } else if (outbox.ackKind === 'rejected') {
    if (typeof payload.acknowledgedAt !== 'number') {
      throw new Error('ack-outbox-invalid-rejection');
    }
    result = await applyActivityRegistrationAckAtomically(ctx, {
      worldId: outbox.worldId,
      inputId: outbox.inputId,
      registrationId: registration._id,
      operationId: registration.operationId,
      agentId: registration.agentId,
      residentId: registration.residentId,
      status: 'rejected',
      reason: 'operation-replaced',
      acknowledgedAt: payload.acknowledgedAt,
    });
  } else if (outbox.ackKind === 'invalid-ack') {
    const reason = payload.reason;
    if (!['missing-ack', 'malformed-ack', 'mismatched-ack'].includes(String(reason))) {
      throw new Error('ack-outbox-invalid-reason');
    }
    const deadLetteredAt = Date.now();
    await ctx.db.patch(registration._id, {
      state: 'abandoned',
      deliveryState: 'failed',
      abandonReason: 'ack-processing-failed',
      updatedAt: deadLetteredAt,
    });
    await ctx.db.patch(outbox._id, {
      status: 'dead-letter',
      errorCode: 'ack-processing-failed',
      updatedAt: deadLetteredAt,
    });
    return { status: 'dead-letter' as const, reason: 'invalid-ack' as const };
  } else {
    await ctx.db.patch(registration._id, {
      state: 'abandoned',
      deliveryState: 'failed',
      abandonReason: 'engine-input-error',
      updatedAt: Date.now(),
    });
    result = { status: 'abandoned' as const };
  }
  if (result.status === 'ignored') {
    throw new Error(`ack-outbox-${result.reason}`);
  }
  const processedAt = Date.now();
  await ctx.db.patch(outbox._id, {
    status: 'processed',
    updatedAt: processedAt,
  });
  return result;
}

export const findConversationCandidate = internalQuery({
  args: {
    now: v.number(),
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
  },
  handler: async (ctx, { now, worldId, player, otherFreePlayers }) => {
    const { position } = player;
    const candidates = [];

    for (const otherPlayer of otherFreePlayers) {
      const lastMember = await ctx.db
        .query('participatedTogether')
        .withIndex('edge', (q) =>
          q.eq('worldId', worldId).eq('player1', player.id).eq('player2', otherPlayer.id),
        )
        .order('desc')
        .first();
      if (lastMember && now < lastMember.ended + PLAYER_CONVERSATION_COOLDOWN) {
        continue;
      }
      candidates.push({ id: otherPlayer.id, position: otherPlayer.position });
    }

    candidates.sort((a, b) => distance(a.position, position) - distance(b.position, position));
    return candidates[0]?.id;
  },
});

export const pendingResidentActivitySettlement = internalQuery({
  args: {
    worldId: v.id('worlds'),
    residentId: playerId,
    activityText: v.string(),
    activityUntil: v.number(),
  },
  handler: pendingResidentActivitySettlementForResident,
});

export async function pendingResidentActivitySettlementForResident(
  ctx: Pick<QueryCtx, 'db'>,
  args: {
    worldId: Id<'worlds'>;
    residentId: string;
    activityText: string;
    activityUntil: number;
  },
) {
  const recent = await ctx.db
    .query('lifeEvents')
    .withIndex('resident', (q) =>
      q.eq('worldId', args.worldId).eq('residentId', args.residentId),
    )
    .order('desc')
    .take(20);
  const start = recent.find((event) =>
    event.phase === 'start'
    && event.economicActionJson !== undefined
    && event.text === `开始${args.activityText}`
    && event.activityUntil === args.activityUntil
    && event.operationId !== undefined
    && event.landmarkId !== undefined,
  );
  if (!start?.operationId || !start.landmarkId) return null;
  const outcomes = await Promise.all(['complete', 'failed'].map((phase) =>
    ctx.db
      .query('lifeEvents')
      .withIndex('sourceKey', (q) =>
        q.eq('worldId', args.worldId)
          .eq('sourceKey', `activity:${start.operationId}:${phase}`),
      )
      .unique(),
  ));
  return outcomes.some(Boolean) ? null : start.landmarkId;
}

export const agentRememberConversation = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    await rememberConversationAndRelease({
      remember: () =>
        rememberConversation(
          ctx,
          args.worldId,
          args.agentId as GameId<'agents'>,
          args.playerId as GameId<'players'>,
          args.conversationId as GameId<'conversations'>,
        ),
      release: async () => {
        await sleep(Math.random() * 1000);
        await ctx.runMutation(internal.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishRememberConversation',
          args: {
            agentId: args.agentId,
            operationId: args.operationId,
          },
        });
      },
    });
  },
});

export const agentGenerateMessage = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    otherPlayerId: playerId,
    operationId: v.string(),
    type: v.union(v.literal('start'), v.literal('continue'), v.literal('leave')),
    messageUuid: v.string(),
  },
  handler: async (ctx, args) => {
    let completionFn: typeof startConversationMessage;
    switch (args.type) {
      case 'start':
        completionFn = startConversationMessage;
        break;
      case 'continue':
        completionFn = continueConversationMessage;
        break;
      case 'leave':
        completionFn = leaveConversationMessage;
        break;
      default:
        assertNever(args.type);
    }
    await generateValidatedResidentMessage(
      { kind: args.type, locale: getWorldLocale() },
      {
        generate: () =>
          completionFn(
            ctx,
            args.worldId,
            args.conversationId as GameId<'conversations'>,
            args.playerId as GameId<'players'>,
            args.otherPlayerId as GameId<'players'>,
          ),
        loadPolicyContext: () =>
          ctx.runQuery(internal.agent.conversation.getConversationPolicyContext, {
            worldId: args.worldId,
            playerId: args.playerId,
            otherPlayerId: args.otherPlayerId,
            conversationId: args.conversationId,
          }),
        recordRejection: (reason) =>
          ctx.runMutation(internal.aiTown.agentOperations.recordConversationPolicyEvent, {
            worldId: args.worldId,
            playerId: args.playerId,
            conversationId: args.conversationId,
            reason,
            createdAt: Date.now(),
          }),
        send: (validatedText) =>
          ctx.runMutation(internal.aiTown.agentOperations.agentSendMessage, {
            worldId: args.worldId,
            conversationId: args.conversationId,
            agentId: args.agentId,
            playerId: args.playerId,
            validatedText,
            messageUuid: args.messageUuid,
            leaveConversation: args.type === 'leave',
            operationId: args.operationId,
          }),
        reportGenerationUnavailable: () => console.warn('resident-message-provider-unavailable'),
        reportMetricUnavailable: (reason) =>
          console.warn(`conversation-policy-metric-unavailable:${reason}`),
      },
    );
  },
});

export const agentDoSomething = internalAction({
  args: {
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    agent: v.object(serializedAgent),
    map: v.object(serializedWorldMap),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
    residentName: v.string(),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { player, agent } = args;
    const map = new WorldMap(args.map);
    const now = Date.now();
    // Don't try to start a new conversation if we were just in one.
    const justLeftConversation =
      agent.lastConversation && now < agent.lastConversation + CONVERSATION_COOLDOWN;
    // Don't try again if we recently tried to find someone to invite.
    const recentlyAttemptedInvite =
      agent.lastInviteAttempt && now < agent.lastInviteAttempt + CONVERSATION_COOLDOWN;
    const recentActivity = player.activity && now < player.activity.until + ACTIVITY_COOLDOWN;
    const pendingLandmarkId = player.activity
      ? await ctx.runQuery(
        internal.aiTown.agentOperations.pendingResidentActivitySettlement,
        {
          worldId: args.worldId,
          residentId: player.id,
          activityText: player.activity.description,
          activityUntil: player.activity.until,
        },
      )
      : null;
    // Decide whether to do an activity or wander somewhere.
    if (!player.pathfinding) {
      if (pendingLandmarkId) {
        await ctx.runMutation(internal.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            destination: townLandmarkById(pendingLandmarkId as TownLandmarkId).destination,
          },
        });
        return;
      }
      if (recentActivity || justLeftConversation) {
        const settlementGraceActive = !!player.activity
          && now >= player.activity.until
          && now < player.activity.until + SETTLEMENT_ARRIVAL_GRACE_MS;
        await sleep(Math.random() * 1000);
        await ctx.runMutation(internal.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            // Keep a just-completed resident at the observed location while the
            // settlement callback verifies arrival; pause retries do not consume this window.
            destination: settlementGraceActive ? player.position : wanderDestination(map),
          },
        });
        return;
      } else {
        const residentState = await ctx.runQuery(
          internal.townEconomy.residentEconomyState,
          { worldId: args.worldId, residentId: player.id },
        );
        if (!residentState) {
          await sleep(Math.random() * 1000);
          await ctx.runMutation(internal.aiTown.main.sendInput, {
            worldId: args.worldId,
            name: 'finishDoSomething',
            args: {
              operationId: args.operationId,
              agentId: agent.id,
              destination: wanderDestination(map),
            },
          });
          return;
        }
        const feasible = feasibleActivitiesForState(args.residentName, residentState);
        const activity = await chooseResidentActivityWithLocalModel(
          args.residentName,
          feasible,
          {
            isWorldRunning: async () => !!(await ctx.runQuery(
              internal.townEconomy.residentEconomyState,
              { worldId: args.worldId, residentId: player.id },
            )),
          },
        );
        if (!activity) return;
        const landmark = townLandmarkById(activity.landmarkId);
        const locatedActivity = `在${landmark.name}：${activity.description}`;
        const activityDuration = activity.duration + 60_000;
        const enqueueResult = await ctx.runMutation(
          internal.aiTown.agentOperations.enqueueResidentActivity,
          {
            worldId: args.worldId,
            residentId: player.id,
            agentId: agent.id,
            operationId: args.operationId,
            activityText: locatedActivity,
            activityDuration,
            landmarkId: activity.landmarkId,
            category: activity.category,
            ...(activity.economicAction ? { economicAction: activity.economicAction } : {}),
            startedAt: now,
            destination: landmark.destination,
            emoji: activity.emoji,
          },
        );
        if (enqueueResult.status === 'world-not-running') return;
        return;
      }
    }
    const invitee =
      justLeftConversation || recentlyAttemptedInvite
        ? undefined
        : await ctx.runQuery(internal.aiTown.agentOperations.findConversationCandidate, {
            now,
            worldId: args.worldId,
            player: args.player,
            otherFreePlayers: args.otherFreePlayers,
          });

    // TODO: We hit a lot of OCC errors on sending inputs in this file. It's
    // easy for them to get scheduled at the same time and line up in time.
    await sleep(Math.random() * 1000);
    await ctx.runMutation(internal.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishDoSomething',
      args: {
        operationId: args.operationId,
        agentId: args.agent.id,
        invitee,
      },
    });
  },
});

function wanderDestination(worldMap: WorldMap) {
  // Wander someonewhere at least one tile away from the edge.
  return {
    x: 1 + Math.floor(Math.random() * (worldMap.width - 2)),
    y: 1 + Math.floor(Math.random() * (worldMap.height - 2)),
  };
}
