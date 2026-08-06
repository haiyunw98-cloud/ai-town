import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { DEFAULT_NAME } from './constants';
import { playerId } from './aiTown/ids';
import { selectConfiguredAiRoster } from './events';
import { buildWerewolfViewerState } from './werewolf/privacy';
import { createWerewolfSetup } from './werewolf/setup';
import {
  applyWerewolfAction,
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
  return buildWerewolfViewerState(next, actorId);
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
}

function stableSeed(value: string) {
  let hash = 0;
  for (const character of value) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return Math.abs(hash) || 1;
}
