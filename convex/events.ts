import { v } from 'convex/values';
import { internal } from './_generated/api';
import { Id } from './_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
  MutationCtx,
  mutation,
  query,
} from './_generated/server';
import { insertInput } from './aiTown/insertInput';
import { GameId, parseGameId } from './aiTown/ids';
import { eventCheckpoints } from '../data/worlds/lighthouse-town/map';
import { requestEventDecision } from './events/model';
import { advanceEvent, createInitialEvent } from './events/stateMachine';
import { EventPhase, TownEventState } from './events/types';

const EVENT_NAME = '灯塔镇百万金贝寻宝赛';

export const ensureFirstEvent = mutation({
  args: {},
  handler: async (ctx) => {
    const worldStatus = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!worldStatus) return { created: false, reason: '世界尚未初始化' };
    const result = await ensureEventForWorld(ctx, worldStatus.worldId);
    if (result.created && result.eventId) {
      await queuePhaseMovement(ctx, worldStatus.worldId, result.eventId, 'announcement');
      await ctx.scheduler.runAfter(0, internal.events.generateNextDecision, {});
    }
    return result;
  },
});

export const advanceActiveEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const worldStatus = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!worldStatus) return;
    await ensureEventForWorld(ctx, worldStatus.worldId);
    const events = await ctx.db.query('townEvents').withIndex('worldId', (q) =>
      q.eq('worldId', worldStatus.worldId),
    ).collect();
    const now = Date.now();
    for (const event of events.filter((entry) => entry.status !== 'completed')) {
      if (event.phaseEndsAt <= now) {
        const current = await loadEventState(ctx, event._id);
        const next = advanceEvent(current, now);
        if (next !== current) {
          await persistEventState(ctx, event._id, next);
          await queuePhaseMovement(ctx, event.worldId, event._id, next.phase);
        }
      }
    }
    await ctx.scheduler.runAfter(0, internal.events.generateNextDecision, {});
  },
});

export const observerSnapshot = query({
  args: { worldId: v.optional(v.id('worlds')) },
  handler: async (ctx, args) => {
    const worldStatus = args.worldId
      ? undefined
      : await ctx.db
          .query('worldStatus')
          .filter((q) => q.eq(q.field('isDefault'), true))
          .first();
    const worldId = args.worldId ?? worldStatus?.worldId;
    if (!worldId) return { event: null, participants: [], logs: [] };
    const event = await ctx.db
      .query('townEvents')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .order('desc')
      .first();
    if (!event) {
      const messages = await ctx.db
        .query('messages')
        .filter((q) => q.eq(q.field('worldId'), worldId))
        .order('desc')
        .take(20);
      const descriptions = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', worldId))
        .collect();
      const names = new Map(descriptions.map((entry) => [entry.playerId, entry.name]));
      return {
        event: null,
        participants: [],
        logs: messages.map((message, index) => ({
          eventKey: `message:${message._id}`,
          sequence: index,
          kind: 'conversation',
          text: `${names.get(message.author) ?? '居民'}：${message.text}`,
          createdAt: message._creationTime,
        })),
      };
    }
    const participants = await ctx.db
      .query('eventParticipants')
      .withIndex('eventId', (q) => q.eq('eventId', event._id))
      .collect();
    const logs = await ctx.db
      .query('eventLog')
      .withIndex('eventId', (q) => q.eq('eventId', event._id))
      .order('desc')
      .take(30);
    return {
      event: {
        id: event._id,
        name: EVENT_NAME,
        status: event.status,
        phase: event.phase,
        phaseEndsAt: event.phaseEndsAt,
        winnerId: event.winnerId,
        prize: '一百万金贝＋灯塔湖畔宅院使用权＋下一届灯塔节命名权',
      },
      participants: participants
        .map(({ residentId, displayName, score, shells, active, role, rank, quote }) => ({
          residentId,
          displayName,
          score,
          shells,
          active,
          role,
          rank,
          quote,
        }))
        .sort((left, right) => (left.rank ?? 99) - (right.rank ?? 99)),
      logs,
    };
  },
});

export const decisionCandidate = internalQuery({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query('townEvents').order('desc').take(5);
    const event = events.find((entry) => entry.status !== 'completed');
    if (!event) return null;
    const participants = await ctx.db
      .query('eventParticipants')
      .withIndex('eventId', (q) => q.eq('eventId', event._id))
      .collect();
    const candidate = participants
      .filter((entry) => entry.decisionPhase !== event.phase)
      .sort((left, right) => Number(right.active) - Number(left.active))[0];
    if (!candidate) return null;
    return {
      eventId: event._id,
      phase: event.phase as EventPhase,
      residentId: candidate.residentId,
      displayName: candidate.displayName,
      identity: candidate.identity,
    };
  },
});

export const generateNextDecision = internalAction({
  args: {},
  handler: async (ctx) => {
    const candidate = await ctx.runQuery(internal.events.decisionCandidate, {});
    if (!candidate) return;
    const decision = await requestEventDecision({
      residentId: candidate.residentId,
      displayName: candidate.displayName,
      identity: candidate.identity,
      phase: candidate.phase,
      choices: choicesForPhase(candidate.phase),
    });
    await ctx.runMutation(internal.events.saveDecision, {
      eventId: candidate.eventId,
      residentId: candidate.residentId,
      phase: candidate.phase,
      choiceId: decision.choiceId,
      publicQuote: decision.publicQuote,
      source: decision.source,
    });
  },
});

export const saveDecision = internalMutation({
  args: {
    eventId: v.id('townEvents'),
    residentId: v.string(),
    phase: v.string(),
    choiceId: v.string(),
    publicQuote: v.string(),
    source: v.union(v.literal('model'), v.literal('fallback')),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event || event.phase !== args.phase) return;
    const participants = await ctx.db
      .query('eventParticipants')
      .withIndex('eventId', (q) => q.eq('eventId', args.eventId))
      .collect();
    const participant = participants.find((entry) => entry.residentId === args.residentId);
    if (!participant || participant.decisionPhase === args.phase) return;
    await ctx.db.patch(participant._id, {
      quote: args.publicQuote,
      decisionPhase: args.phase,
    });
    const eventKey = `quote:${args.phase}:${args.residentId}`;
    const duplicate = await ctx.db
      .query('eventLog')
      .withIndex('eventKey', (q) => q.eq('eventId', args.eventId).eq('eventKey', eventKey))
      .first();
    if (!duplicate) {
      const latest = await ctx.db
        .query('eventLog')
        .withIndex('eventId', (q) => q.eq('eventId', args.eventId))
        .order('desc')
        .first();
      await ctx.db.insert('eventLog', {
        eventId: args.eventId,
        eventKey,
        sequence: (latest?.sequence ?? -1) + 1,
        kind: 'interview',
        text: `${participant.displayName}选择“${args.choiceId}”：${args.publicQuote}`,
        createdAt: Date.now(),
      });
    }
  },
});

async function ensureEventForWorld(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const existing = await ctx.db
    .query('townEvents')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .order('desc')
    .first();
  if (existing) return { created: false, eventId: existing._id, reason: '首场赛事已经存在' };
  const world = await ctx.db.get(worldId);
  if (!world || world.agents.length !== 8) {
    return { created: false, reason: `等待八位居民，目前为 ${world?.agents.length ?? 0} 位` };
  }
  const playerDescriptions = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .collect();
  const agentDescriptions = await ctx.db
    .query('agentDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .collect();
  if (playerDescriptions.length !== 8 || agentDescriptions.length !== 8) {
    return { created: false, reason: '等待八位居民资料同步' };
  }
  const playerById = new Map(playerDescriptions.map((entry) => [entry.playerId, entry]));
  const agentById = new Map(agentDescriptions.map((entry) => [entry.agentId, entry]));
  const residents = world.agents.map((agent) => {
    const player = playerById.get(agent.playerId);
    const description = agentById.get(agent.id);
    if (!player || !description) throw new Error(`Missing description for ${agent.id}`);
    return {
      residentId: agent.playerId,
      displayName: player.name,
      identity: description.identity,
    };
  });
  const now = Date.now();
  const state = createInitialEvent(String(worldId), residents, now % 2_147_483_647, now);
  const eventId = await ctx.db.insert('townEvents', {
    worldId,
    status: 'announced',
    phase: state.phase,
    seed: state.seed,
    phaseEndsAt: state.phaseEndsAt,
    updatedAt: now,
  });
  for (const participant of state.participants) {
    const identity = residents.find((entry) => entry.residentId === participant.residentId)!.identity;
    await ctx.db.insert('eventParticipants', { eventId, identity, ...participant });
  }
  for (const entry of state.log) await ctx.db.insert('eventLog', { eventId, ...entry });
  return { created: true, eventId, reason: '赛事已经公布' };
}

async function loadEventState(ctx: MutationCtx, eventId: Id<'townEvents'>): Promise<TownEventState> {
  const event = await ctx.db.get(eventId);
  if (!event) throw new Error(`Invalid event ID: ${eventId}`);
  const participantDocs = await ctx.db
    .query('eventParticipants')
    .withIndex('eventId', (q) => q.eq('eventId', eventId))
    .collect();
  const logDocs = await ctx.db
    .query('eventLog')
    .withIndex('eventId', (q) => q.eq('eventId', eventId))
    .collect();
  return {
    worldId: String(event.worldId),
    seed: event.seed,
    phase: event.phase as EventPhase,
    phaseEndsAt: event.phaseEndsAt,
    activeCount: participantDocs.filter((entry) => entry.active).length,
    winnerId: event.winnerId,
    participants: participantDocs.map(
      ({ residentId, displayName, score, shells, active, role, rank }) => ({
        residentId,
        displayName,
        score,
        shells,
        active,
        role: role as TownEventState['participants'][number]['role'],
        rank,
      }),
    ),
    log: logDocs.map(({ eventKey, sequence, kind, text, createdAt }) => ({
      eventKey,
      sequence,
      kind: kind as TownEventState['log'][number]['kind'],
      text,
      createdAt,
    })),
  };
}

async function persistEventState(
  ctx: MutationCtx,
  eventId: Id<'townEvents'>,
  state: TownEventState,
) {
  await ctx.db.patch(eventId, {
    status: state.phase === 'awards' ? 'completed' : 'running',
    phase: state.phase,
    phaseEndsAt: state.phaseEndsAt,
    winnerId: state.winnerId,
    updatedAt: Date.now(),
  });
  const docs = await ctx.db
    .query('eventParticipants')
    .withIndex('eventId', (q) => q.eq('eventId', eventId))
    .collect();
  for (const participant of state.participants) {
    const doc = docs.find((entry) => entry.residentId === participant.residentId);
    if (!doc) continue;
    await ctx.db.patch(doc._id, {
      score: participant.score,
      shells: participant.shells,
      active: participant.active,
      role: participant.role,
      rank: participant.rank,
    });
  }
  for (const entry of state.log) {
    const exists = await ctx.db
      .query('eventLog')
      .withIndex('eventKey', (q) => q.eq('eventId', eventId).eq('eventKey', entry.eventKey))
      .first();
    if (!exists) await ctx.db.insert('eventLog', { eventId, ...entry });
  }
}

async function queuePhaseMovement(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  eventId: Id<'townEvents'>,
  phase: EventPhase,
) {
  const participants = await ctx.db
    .query('eventParticipants')
    .withIndex('eventId', (q) => q.eq('eventId', eventId))
    .collect();
  const destinations = destinationsForPhase(phase);
  for (const [index, participant] of participants.entries()) {
    const destination = participant.active
      ? destinations[index % destinations.length]
      : eventCheckpoints.plaza;
    await insertInput(ctx, worldId, 'eventMove', {
      playerId: parseGameId('players', participant.residentId) as GameId<'players'>,
      destination,
      description: participant.active ? phaseActivity(phase) : '在灯塔广场担任赛事评论员',
      until: Date.now() + 5 * 60_000,
    });
  }
}

function destinationsForPhase(phase: EventPhase) {
  if (phase === 'announcement' || phase === 'awards') return [eventCheckpoints.plaza];
  if (phase === 'treasureHunt') return Object.values(eventCheckpoints).filter(
    (_checkpoint, index) => index > 0,
  );
  if (phase === 'lanternRelay') return [eventCheckpoints.dock, eventCheckpoints.workshop];
  if (phase === 'secretTrade') return [eventCheckpoints.teahouse, eventCheckpoints.academy];
  return [eventCheckpoints.plaza, eventCheckpoints.lanternShop];
}

function phaseActivity(phase: EventPhase) {
  const descriptions: Record<EventPhase, string> = {
    announcement: '前往灯塔广场参加百万金贝寻宝赛开幕式',
    treasureHunt: '在全镇寻找刻有地标的金贝',
    lanternRelay: '与搭档护送灯火穿过水巷',
    secretTrade: '与其他选手交换或保留关键线索',
    lighthouseFinal: '收集最后钥匙并赶往灯塔',
    awards: '参加百万金贝寻宝赛颁奖礼',
  };
  return descriptions[phase];
}

function choicesForPhase(phase: EventPhase) {
  const choices: Record<EventPhase, { id: string; label: string }[]> = {
    announcement: [
      { id: 'bold', label: '公开表达夺冠决心' },
      { id: 'friendly', label: '祝福其他参赛者并稳健出发' },
    ],
    treasureHunt: [
      { id: 'explore', label: '前往较远地标独立搜索' },
      { id: 'observe', label: '观察他人的路线后寻找遗漏线索' },
    ],
    lanternRelay: [
      { id: 'cooperate', label: '放慢速度确保搭档跟上' },
      { id: 'sprint', label: '承担风险加快接力速度' },
    ],
    secretTrade: [
      { id: 'share', label: '把线索分享给临时盟友' },
      { id: 'keep', label: '保留线索独自行动' },
    ],
    lighthouseFinal: [
      { id: 'steady', label: '稳妥检查钥匙和罗盘' },
      { id: 'rush', label: '立即冲向灯塔抢先点灯' },
    ],
    awards: [
      { id: 'thank', label: '感谢其他参赛者' },
      { id: 'celebrate', label: '邀请全镇一起庆祝' },
    ],
  };
  return choices[phase];
}
