import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import { DEFAULT_NAME } from './constants';
import { parseGameId, playerId } from './aiTown/ids';
import { insertInput } from './aiTown/insertInput';
import { selectConfiguredAiRoster } from './events';
import { buildWerewolfViewerState } from './werewolf/privacy';
import { requestWerewolfAction } from './werewolf/model';
import { buildWerewolfMovementCommands } from './werewolf/movement';
import { createWerewolfSetup } from './werewolf/setup';
import {
  applyWerewolfAction,
  applySystemStep,
  beginWerewolfGame,
} from './werewolf/stateMachine';
import type {
  WerewolfAction,
  WerewolfEntrant,
  WerewolfPhase,
  WerewolfState,
} from './werewolf/types';

type RosterResident = {
  residentId: string;
  displayName: string;
  identity: string;
};

type WorldRuntimeStatus = 'running' | 'stoppedByDeveloper' | 'inactive';

export function sessionRunMode(status: WorldRuntimeStatus) {
  return status === 'running' ? 'run' as const : 'pause' as const;
}

export function humanTurnDeadline(now: number, existing?: number) {
  return existing ?? now + 90_000;
}

export function selectPendingActor(state: WerewolfState): {
  actorId: string;
  kind: WerewolfAction['kind'];
  requested: 'speech' | 'target' | 'witch';
  human: boolean;
} | undefined {
  const acted = (actorId: string, kind: WerewolfAction['kind']) => state.actions.some((action) =>
    action.actorId === actorId && action.kind === kind && action.round === state.round &&
    action.phase === state.phase,
  );
  let actorId: string | undefined;
  let kind: WerewolfAction['kind'] | undefined;
  let requested: 'speech' | 'target' | 'witch' | undefined;
  if (state.phase === 'night-wolves') {
    actorId = state.seats.find((seat) =>
      seat.alive && seat.role === 'werewolf' && !acted(seat.playerId, 'wolf-vote'))?.playerId;
    kind = 'wolf-vote';
    requested = 'target';
  } else if (state.phase === 'night-seer') {
    actorId = state.seats.find((seat) => seat.alive && seat.role === 'seer')?.playerId;
    kind = 'seer-check';
    requested = 'target';
  } else if (state.phase === 'night-witch') {
    actorId = state.seats.find((seat) => seat.alive && seat.role === 'witch')?.playerId;
    kind = 'witch-use';
    requested = 'witch';
  } else if (state.phase === 'day-speaking' || state.phase === 'runoff-speaking') {
    actorId = state.speakingOrder[0];
    kind = 'speech';
    requested = 'speech';
  } else if (state.phase === 'day-voting' || state.phase === 'runoff-voting') {
    actorId = state.seats.find((seat) =>
      seat.alive && !acted(seat.playerId, 'day-vote'))?.playerId;
    kind = 'day-vote';
    requested = 'target';
  } else if (state.phase === 'hunter') {
    actorId = state.pendingHunterId;
    kind = 'hunter-shot';
    requested = 'target';
  }
  if (!actorId || !kind || !requested) return undefined;
  return {
    actorId,
    kind,
    requested,
    human: state.seats.find((seat) => seat.playerId === actorId)?.kind === 'human',
  };
}

export function assertWerewolfCanStart(input: {
  runningDailyEvent: boolean;
  runningWerewolf: boolean;
}) {
  if (input.runningDailyEvent) throw new Error('每日活动进行中，狼人杀场地正忙。');
  if (input.runningWerewolf) throw new Error('已有一场狼人杀进行中。');
}

export function buildSessionEntrants(
  roster: readonly RosterResident[],
  mode: 'observe' | 'play',
  seed: number,
): { entrants: WerewolfEntrant[]; spectator?: RosterResident } {
  if (roster.length !== 9) throw new Error('狼人杀需要九位已配置居民。');
  if (mode === 'observe') {
    return {
      entrants: roster.map((resident) => ({
        playerId: resident.residentId,
        displayName: resident.displayName,
        kind: 'ai' as const,
      })),
    };
  }
  const spectatorIndex = Math.abs(seed) % roster.length;
  const spectator = roster[spectatorIndex];
  return {
    entrants: [
      { playerId: `human:${DEFAULT_NAME}`, displayName: '你（ME）', kind: 'human' },
      ...roster.filter((_, index) => index !== spectatorIndex).map((resident) => ({
        playerId: resident.residentId,
        displayName: resident.displayName,
        kind: 'ai' as const,
      })),
    ],
    spectator,
  };
}

export function werewolfActionKey(
  sessionId: string,
  round: number,
  phase: WerewolfPhase,
  actorId: string,
) {
  return `${sessionId}:${round}:${phase}:${actorId}`;
}

export const startSession = mutation({
  args: {
    worldId: v.id('worlds'),
    mode: v.union(v.literal('observe'), v.literal('play')),
  },
  handler: async (ctx, args) => startWerewolfSession(ctx, args),
});

export async function startWerewolfSession(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; mode: 'observe' | 'play' },
) {
  const now = Date.now();
  const [world, worldStatus, runningSessions, events, playerDescriptions, agentDescriptions] =
    await Promise.all([
      ctx.db.get(args.worldId),
      ctx.db.query('worldStatus').withIndex('worldId', (q) => q.eq('worldId', args.worldId)).unique(),
      ctx.db.query('werewolfSessions')
        .withIndex('sessionKey', (q) => q.eq('worldId', args.worldId).eq('status', 'running'))
        .collect(),
      ctx.db.query('townEvents').withIndex('worldId', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId)).take(33),
      ctx.db.query('agentDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId)).take(33),
    ]);
  if (!world || !worldStatus) throw new Error('狼人杀世界不存在。');
  if (worldStatus.status !== 'running') throw new Error('小镇暂停时不能开始狼人杀。');
  assertWerewolfCanStart({
    runningDailyEvent: events.some((event) => event.status === 'announced' || event.status === 'running'),
    runningWerewolf: runningSessions.length > 0,
  });
  if (playerDescriptions.length === 33 || agentDescriptions.length === 33) {
    throw new Error('狼人杀居民资料超过安全读取上限。');
  }
  const roster = selectConfiguredAiRoster(world, playerDescriptions, agentDescriptions);
  const seed = stableSeed(`${args.worldId}:${now}`);
  const selected = buildSessionEntrants(roster, args.mode, seed);
  const seats = createWerewolfSetup(selected.entrants, seed);
  const state = beginWerewolfGame(seats, seed, now);
  const humanPlayerId = selected.entrants.find((entrant) => entrant.kind === 'human')?.playerId;
  const sessionId = await ctx.db.insert('werewolfSessions', {
    worldId: args.worldId,
    status: 'running',
    phase: state.phase,
    round: state.round,
    seed,
    mode: args.mode,
    humanPlayerId,
    spectatorPlayerId: selected.spectator?.residentId,
    stateJson: JSON.stringify(state),
    nextActionAt: now,
    startedAt: now,
    updatedAt: now,
  });
  const identities = new Map(roster.map((resident) => [resident.residentId, resident.identity]));
  for (const seat of seats) {
    await ctx.db.insert('werewolfSeats', {
      sessionId,
      playerId: seat.playerId,
      displayName: seat.displayName,
      identity: identities.get(seat.playerId) ?? '你以观察者身份加入这场安全的狼人杀。',
      kind: seat.kind,
      seatNumber: seat.seatNumber,
      role: seat.role,
      alive: seat.alive,
      stateJson: JSON.stringify(seat),
    });
  }
  await ctx.db.insert('werewolfActions', {
    sessionId,
    actionKey: `${sessionId}:start`,
    sequence: 0,
    round: 1,
    phase: 'night-wolves',
    kind: 'session-start',
    visibility: 'system',
    text: args.mode === 'play' ? '观察者加入本局，九人就座。' : '九位居民就座，观察局开始。',
    source: 'system',
    createdAt: now,
  });
  await enqueueWerewolfMovements(ctx, args.worldId, seats, 'seating', now);
  await ctx.scheduler.runAfter(0, internal.werewolf.advanceSession, { sessionId });
  return { sessionId, mode: args.mode, spectatorPlayerId: selected.spectator?.residentId };
}

export const viewerState = query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => queryWerewolfViewerState(ctx, args.worldId),
});

async function latestSession(ctx: QueryCtx, worldId: Id<'worlds'>) {
  const sessions = await ctx.db.query('werewolfSessions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId)).order('desc').take(2);
  return sessions.find((session) => session.status === 'running' || session.status === 'paused') ??
    sessions[0];
}

export async function queryWerewolfViewerState(ctx: QueryCtx, worldId: Id<'worlds'>) {
  const session = await latestSession(ctx, worldId);
  if (!session) return null;
  const state = JSON.parse(session.stateJson) as WerewolfState;
  const viewerId = session.mode === 'play' ? session.humanPlayerId : undefined;
  return {
    sessionId: session._id,
    status: session.status,
    mode: session.mode,
    spectatorPlayerId: session.spectatorPlayerId,
    ...buildWerewolfViewerState(state, viewerId),
  };
}

export const submitHumanAction = mutation({
  args: {
    sessionId: v.id('werewolfSessions'),
    kind: v.union(v.literal('speech'), v.literal('target'), v.literal('witch')),
    text: v.optional(v.string()),
    targetId: v.optional(playerId),
    save: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => commitHumanWerewolfAction(ctx, args),
});

export async function commitHumanWerewolfAction(
  ctx: MutationCtx,
  args: {
    sessionId: Id<'werewolfSessions'>;
    kind: 'speech' | 'target' | 'witch';
    text?: string;
    targetId?: string;
    save?: boolean;
  },
) {
  const session = await ctx.db.get(args.sessionId);
  if (!session || session.status !== 'running' || !session.humanPlayerId) {
    throw new Error('没有等待你操作的狼人杀对局。');
  }
  const state = JSON.parse(session.stateJson) as WerewolfState;
  const actorId = session.humanPlayerId;
  const key = werewolfActionKey(String(session._id), state.round, state.phase, actorId);
  const duplicate = await ctx.db.query('werewolfActions')
    .withIndex('actionKey', (q) => q.eq('sessionId', session._id).eq('actionKey', key)).unique();
  if (duplicate) return buildWerewolfViewerState(state, actorId);
  const action = humanActionForState(state, actorId, args, Math.max(Date.now(), state.updatedAt + 1));
  const next = applyWerewolfAction(state, action);
  const sequence = await ctx.db.query('werewolfActions')
    .withIndex('sessionId', (q) => q.eq('sessionId', session._id)).collect();
  await ctx.db.insert('werewolfActions', {
    sessionId: session._id,
    actionKey: key,
    sequence: sequence.length,
    round: state.round,
    phase: state.phase,
    actorId,
    kind: action.kind,
    visibility: action.kind === 'speech' || action.kind === 'hunter-shot' ? 'public' : 'private',
    targetId: 'targetId' in action ? action.targetId :
      action.kind === 'witch-use' ? action.poisonTargetId : undefined,
    text: action.kind === 'speech' ? action.text : undefined,
    source: 'human',
    createdAt: action.at,
  });
  await persistState(ctx, session._id, next, action.at);
  await ctx.scheduler.runAfter(0, internal.werewolf.advanceSession, { sessionId: session._id });
  return buildWerewolfViewerState(next, actorId);
}

export const advanceSession = internalMutation({
  args: { sessionId: v.id('werewolfSessions') },
  handler: async (ctx, args) => advanceWerewolfSession(ctx, args.sessionId),
});

export async function advanceWerewolfSession(
  ctx: MutationCtx,
  sessionId: Id<'werewolfSessions'>,
) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.status === 'completed') return { scheduledModelActions: 0 };
  const worldStatus = await ctx.db.query('worldStatus')
    .withIndex('worldId', (q) => q.eq('worldId', session.worldId)).unique();
  if (!worldStatus || sessionRunMode(worldStatus.status) === 'pause') {
    if (session.status !== 'paused') await ctx.db.patch(session._id, { status: 'paused' });
    await ctx.scheduler.runAfter(30_000, internal.werewolf.advanceSession, { sessionId });
    return { scheduledModelActions: 0, paused: true };
  }
  if (session.status === 'paused') await ctx.db.patch(session._id, { status: 'running' });
  let state = JSON.parse(session.stateJson) as WerewolfState;
  const now = Math.max(Date.now(), state.updatedAt + 1);
  if (state.phase === 'dawn') {
    state = applySystemStep(state, now);
    await persistState(ctx, sessionId, state, now);
    await recordSystemTransition(ctx, sessionId, state, now);
    if (state.phase !== 'completed') {
      await ctx.scheduler.runAfter(0, internal.werewolf.advanceSession, { sessionId });
    }
    return { scheduledModelActions: 0, systemStep: true };
  }
  const pending = selectPendingActor(state);
  if (!pending) return { scheduledModelActions: 0 };
  const key = werewolfActionKey(String(sessionId), state.round, state.phase, pending.actorId);
  const existing = await ctx.db.query('werewolfActions')
    .withIndex('actionKey', (q) => q.eq('sessionId', sessionId).eq('actionKey', key)).unique();
  if (existing) {
    if (existing.kind === 'ai-pending' && Date.now() - existing.createdAt > 120_000) {
      await ctx.db.delete(existing._id);
      await ctx.scheduler.runAfter(0, internal.werewolf.advanceSession, { sessionId });
      return { scheduledModelActions: 0, recovered: true };
    }
    return { scheduledModelActions: 0, duplicate: true };
  }

  if (pending.human) {
    const initialized = session.nextActionAt > state.updatedAt ? session.nextActionAt : undefined;
    const deadlineAt = humanTurnDeadline(now, initialized);
    if (!initialized) {
      await ctx.db.patch(sessionId, { nextActionAt: deadlineAt, updatedAt: now });
      await ctx.scheduler.runAt(deadlineAt, internal.werewolf.advanceSession, { sessionId });
      return { scheduledModelActions: 0, deadlineAt };
    }
    if (Date.now() < deadlineAt) {
      await ctx.scheduler.runAt(deadlineAt, internal.werewolf.advanceSession, { sessionId });
      return { scheduledModelActions: 0, deadlineAt };
    }
    const view = buildWerewolfViewerState(state, pending.actorId);
    const fallback = fallbackForPending(state, pending, view.legalTargets, now);
    const next = applyWerewolfAction(state, fallback);
    await insertCommittedAction(ctx, sessionId, key, state, fallback, 'fallback');
    await persistState(ctx, sessionId, next, now);
    await ctx.scheduler.runAfter(0, internal.werewolf.advanceSession, { sessionId });
    return { scheduledModelActions: 0, timedOut: true };
  }

  const actions = await ctx.db.query('werewolfActions')
    .withIndex('sessionId', (q) => q.eq('sessionId', sessionId)).collect();
  await ctx.db.insert('werewolfActions', {
    sessionId,
    actionKey: key,
    sequence: actions.length,
    round: state.round,
    phase: state.phase,
    actorId: pending.actorId,
    kind: 'ai-pending',
    visibility: 'private',
    source: 'system',
    createdAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.werewolf.generateAiAction, {
    sessionId,
    actorId: pending.actorId,
    actionKey: key,
  });
  return { scheduledModelActions: 1 };
}

export const aiActionCandidate = internalQuery({
  args: {
    sessionId: v.id('werewolfSessions'),
    actorId: playerId,
    actionKey: v.string(),
  },
  handler: async (ctx, args) => {
    const [session, pending, seatDocument] = await Promise.all([
      ctx.db.get(args.sessionId),
      ctx.db.query('werewolfActions')
        .withIndex('actionKey', (q) => q.eq('sessionId', args.sessionId).eq('actionKey', args.actionKey))
        .unique(),
      ctx.db.query('werewolfSeats')
        .withIndex('player', (q) => q.eq('sessionId', args.sessionId).eq('playerId', args.actorId))
        .unique(),
    ]);
    if (!session || session.status !== 'running' || pending?.kind !== 'ai-pending' || !seatDocument) {
      return null;
    }
    const state = JSON.parse(session.stateJson) as WerewolfState;
    const turn = selectPendingActor(state);
    if (!turn || turn.actorId !== args.actorId || turn.human) return null;
    return {
      view: buildWerewolfViewerState(state, args.actorId),
      identity: seatDocument.identity,
      requested: turn.requested,
      seedKey: args.actionKey,
    };
  },
});

export const generateAiAction = internalAction({
  args: {
    sessionId: v.id('werewolfSessions'),
    actorId: playerId,
    actionKey: v.string(),
  },
  handler: async (ctx, args) => {
    const candidate = await ctx.runQuery(internal.werewolf.aiActionCandidate, args);
    if (!candidate) return;
    const result = await requestWerewolfAction(candidate);
    await ctx.runMutation(internal.werewolf.commitAiAction, {
      ...args,
      resultJson: JSON.stringify(result),
    });
  },
});

export const commitAiAction = internalMutation({
  args: {
    sessionId: v.id('werewolfSessions'),
    actorId: playerId,
    actionKey: v.string(),
    resultJson: v.string(),
  },
  handler: async (ctx, args) => {
    const [session, pending] = await Promise.all([
      ctx.db.get(args.sessionId),
      ctx.db.query('werewolfActions')
        .withIndex('actionKey', (q) => q.eq('sessionId', args.sessionId).eq('actionKey', args.actionKey))
        .unique(),
    ]);
    if (!session || session.status !== 'running' || pending?.kind !== 'ai-pending') return;
    const state = JSON.parse(session.stateJson) as WerewolfState;
    const turn = selectPendingActor(state);
    if (!turn || turn.actorId !== args.actorId || turn.human) return;
    const result = JSON.parse(args.resultJson) as {
      source: 'model' | 'fallback'; text?: string; targetId?: string; save?: boolean;
    };
    const at = Math.max(Date.now(), state.updatedAt + 1);
    const action = actionFromModelResult(state, turn, result, at);
    const next = applyWerewolfAction(state, action);
    await ctx.db.patch(pending._id, {
      kind: action.kind,
      visibility: action.kind === 'speech' || action.kind === 'hunter-shot' ? 'public' : 'private',
      targetId: 'targetId' in action ? action.targetId :
        action.kind === 'witch-use' ? action.poisonTargetId : undefined,
      text: action.kind === 'speech' ? action.text : undefined,
      source: result.source,
      createdAt: at,
    });
    await persistState(ctx, args.sessionId, next, at);
    await ctx.scheduler.runAfter(0, internal.werewolf.advanceSession, { sessionId: args.sessionId });
  },
});

type PendingTurn = NonNullable<ReturnType<typeof selectPendingActor>>;

function actionFromModelResult(
  state: WerewolfState,
  turn: PendingTurn,
  result: { text?: string; targetId?: string; save?: boolean },
  at: number,
): WerewolfAction {
  if (turn.kind === 'speech') {
    return { kind: 'speech', actorId: turn.actorId, text: result.text ?? '我再听听大家的判断。', at };
  }
  if (turn.kind === 'witch-use') {
    return {
      kind: 'witch-use', actorId: turn.actorId, save: result.save === true,
      poisonTargetId: result.targetId, at,
    };
  }
  if (turn.kind === 'wolf-vote' || turn.kind === 'seer-check') {
    const view = buildWerewolfViewerState(state, turn.actorId);
    const targetId = result.targetId ?? view.legalTargets[0];
    if (!targetId) throw new Error('狼人杀强制目标阶段没有合法目标。');
    return { kind: turn.kind, actorId: turn.actorId, targetId, at };
  }
  return { kind: turn.kind, actorId: turn.actorId, targetId: result.targetId, at };
}

function fallbackForPending(
  state: WerewolfState,
  turn: PendingTurn,
  legalTargets: readonly string[],
  at: number,
): WerewolfAction {
  if (turn.kind === 'speech') {
    return { kind: 'speech', actorId: turn.actorId, text: '我先记下大家的说法，再结合票型判断。', at };
  }
  if (turn.kind === 'witch-use') {
    const witch = state.seats.find((seat) => seat.playerId === turn.actorId)!;
    return {
      kind: 'witch-use',
      actorId: turn.actorId,
      save: witch.antidoteAvailable && !!state.pendingNightTargetId &&
        (state.round === 1 || state.pendingNightTargetId !== turn.actorId),
      at,
    };
  }
  if (turn.kind === 'wolf-vote' || turn.kind === 'seer-check') {
    const targetId = legalTargets[0];
    if (!targetId) throw new Error('狼人杀超时回退没有合法目标。');
    return { kind: turn.kind, actorId: turn.actorId, targetId, at };
  }
  return { kind: turn.kind, actorId: turn.actorId, targetId: undefined, at };
}

async function insertCommittedAction(
  ctx: MutationCtx,
  sessionId: Id<'werewolfSessions'>,
  key: string,
  state: WerewolfState,
  action: WerewolfAction,
  source: 'human' | 'model' | 'fallback',
) {
  const actions = await ctx.db.query('werewolfActions')
    .withIndex('sessionId', (q) => q.eq('sessionId', sessionId)).collect();
  await ctx.db.insert('werewolfActions', {
    sessionId,
    actionKey: key,
    sequence: actions.length,
    round: state.round,
    phase: state.phase,
    actorId: action.actorId,
    kind: action.kind,
    visibility: action.kind === 'speech' || action.kind === 'hunter-shot' ? 'public' : 'private',
    targetId: 'targetId' in action ? action.targetId :
      action.kind === 'witch-use' ? action.poisonTargetId : undefined,
    text: action.kind === 'speech' ? action.text : undefined,
    source,
    createdAt: action.at,
  });
}

async function recordSystemTransition(
  ctx: MutationCtx,
  sessionId: Id<'werewolfSessions'>,
  state: WerewolfState,
  at: number,
) {
  const actions = await ctx.db.query('werewolfActions')
    .withIndex('sessionId', (q) => q.eq('sessionId', sessionId)).collect();
  await ctx.db.insert('werewolfActions', {
    sessionId,
    actionKey: `${sessionId}:system:${state.round}:${state.phase}:${at}`,
    sequence: actions.length,
    round: state.round,
    phase: state.phase,
    kind: 'phase-transition',
    visibility: 'system',
    text: state.phase === 'completed'
      ? `本局结束，${state.winner === 'good' ? '好人阵营' : '狼人阵营'}获胜。`
      : `天亮了，进入第 ${state.round} 轮白天讨论。`,
    source: 'system',
    createdAt: at,
  });
}

function humanActionForState(
  state: WerewolfState,
  actorId: string,
  input: { kind: 'speech' | 'target' | 'witch'; text?: string; targetId?: string; save?: boolean },
  at: number,
): WerewolfAction {
  if (input.kind === 'speech') {
    if (!input.text) throw new Error('发言不能为空。');
    return { kind: 'speech', actorId, text: input.text, at };
  }
  if (input.kind === 'witch') {
    return {
      kind: 'witch-use', actorId, save: input.save === true,
      poisonTargetId: input.targetId, at,
    };
  }
  if (state.phase === 'night-wolves') {
    if (!input.targetId) throw new Error('请选择夜间目标。');
    return { kind: 'wolf-vote', actorId, targetId: input.targetId, at };
  }
  if (state.phase === 'night-seer') {
    if (!input.targetId) throw new Error('请选择查验目标。');
    return { kind: 'seer-check', actorId, targetId: input.targetId, at };
  }
  if (state.phase === 'day-voting' || state.phase === 'runoff-voting') {
    return { kind: 'day-vote', actorId, targetId: input.targetId, at };
  }
  if (state.phase === 'hunter') {
    return { kind: 'hunter-shot', actorId, targetId: input.targetId, at };
  }
  throw new Error('当前阶段不能选择目标。');
}

async function persistState(
  ctx: MutationCtx,
  sessionId: Id<'werewolfSessions'>,
  state: WerewolfState,
  at: number,
) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error('狼人杀会话在保存前已丢失。');
  const previous = JSON.parse(session.stateJson) as WerewolfState;
  await ctx.db.patch(sessionId, {
    status: state.phase === 'completed' ? 'completed' : 'running',
    phase: state.phase,
    round: state.round,
    stateJson: JSON.stringify(state),
    nextActionAt: at,
    winner: state.winner,
    endedAt: state.phase === 'completed' ? at : undefined,
    updatedAt: at,
  });
  for (const seat of state.seats) {
    const document = await ctx.db.query('werewolfSeats')
      .withIndex('player', (q) => q.eq('sessionId', sessionId).eq('playerId', seat.playerId)).unique();
    if (!document) throw new Error(`狼人杀座位丢失：${seat.playerId}`);
    await ctx.db.patch(document._id, {
      alive: seat.alive,
      stateJson: JSON.stringify(seat),
    });
  }
  if (state.phase === 'completed' && previous.phase !== 'completed') {
    await enqueueWerewolfMovements(ctx, session.worldId, state.seats, 'return', at);
    return;
  }
  const newlyEliminated = new Set(state.seats.filter((seat) =>
    !seat.alive && previous.seats.find((oldSeat) => oldSeat.playerId === seat.playerId)?.alive,
  ).map((seat) => seat.playerId));
  if (newlyEliminated.size > 0) {
    const commands = buildWerewolfMovementCommands(state.seats, 'elimination', at)
      .filter((command) => newlyEliminated.has(command.residentId));
    await enqueueMovementCommands(ctx, session.worldId, commands);
  }
}

async function enqueueWerewolfMovements(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  seats: readonly WerewolfState['seats'][number][],
  phase: 'seating' | 'elimination' | 'return',
  now: number,
) {
  await enqueueMovementCommands(
    ctx,
    worldId,
    buildWerewolfMovementCommands(seats, phase, now),
  );
}

async function enqueueMovementCommands(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  commands: readonly ReturnType<typeof buildWerewolfMovementCommands>[number][],
) {
  for (const command of commands) {
    try {
      await insertInput(ctx, worldId, 'eventMove', {
        playerId: parseGameId('players', command.residentId),
        destination: command.destination,
        description: command.description,
        until: command.until,
      });
    } catch (error) {
      console.warn('Werewolf movement input was deferred.', {
        residentId: command.residentId,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}

function stableSeed(value: string) {
  let hash = 0;
  for (const character of value) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return Math.abs(hash) || 1;
}
