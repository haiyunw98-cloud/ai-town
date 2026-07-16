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
import { parseGameId } from './aiTown/ids';
import { eventCheckpoints } from '../data/worlds/lighthouse-town/map';
import { requestEventDecision } from './events/model';
import { advanceEvent, createInitialEvent } from './events/stateMachine';
import { EventPhase, TownEventState } from './events/types';

const EVENT_NAME = '灯塔镇百万金贝寻宝赛';

export function isObserverIntervention(
  humanPlayerIds: ReadonlySet<string>,
  authorId: string,
) {
  return humanPlayerIds.has(authorId);
}

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
    if (!worldId) {
      return {
        event: null,
        participants: [],
        logs: [],
        conversations: [],
        residentActivity: [],
        dailyLifeEvents: [],
        dailyMessages: [],
      };
    }
    const descriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .collect();
    const names = new Map(descriptions.map((entry) => [entry.playerId, entry.name]));
    const world = await ctx.db.get(worldId);
    const humanPlayerIds = new Set(
      (world?.players ?? []).filter((player) => !!player.human).map((player) => player.id),
    );
    const dailyLifeEvents = (await ctx.db
      .query('lifeEvents')
      .filter((q) => q.eq(q.field('worldId'), worldId))
      .collect())
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 500)
      .map((entry) => ({
        residentId: entry.residentId,
        displayName: names.get(entry.residentId) ?? '居民',
        kind: entry.kind,
        text: entry.text,
        createdAt: entry.createdAt,
      }));
    const messages = await ctx.db
      .query('messages')
      .filter((q) => q.eq(q.field('worldId'), worldId))
      .order('desc')
      .take(500);
    const legacyMessages = messages.slice(0, 80);
    const dailyMessages = messages.map((message) => ({
      messageId: String(message._id),
      conversationId: message.conversationId,
      authorId: message.author,
      authorName: names.get(message.author) ?? (message.author.startsWith('p:') ? '居民' : '观察者'),
      text: message.text,
      createdAt: message._creationTime,
      observerIntervention: isObserverIntervention(humanPlayerIds, message.author),
    }));
    const conversations = groupConversationMessages(legacyMessages, names, world?.conversations ?? []);
    const residentActivity = buildResidentActivity(world?.players ?? [], world?.conversations ?? [], names);
    const event = await ctx.db
      .query('townEvents')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .order('desc')
      .first();
    if (!event) {
      return {
        event: null,
        participants: [],
        conversations,
        residentActivity,
        dailyLifeEvents,
        dailyMessages,
        logs: legacyMessages.map((message, index) => ({
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
      conversations,
      residentActivity,
      dailyLifeEvents,
      dailyMessages,
    };
  },
});

function groupConversationMessages(
  messages: Array<{ conversationId: string; author: string; text: string; _creationTime: number }>,
  names: Map<string, string>,
  liveConversations: Array<{ id: string; participants: Array<{ playerId: string }> }>,
) {
  const grouped = new Map<string, typeof messages>();
  for (const message of messages) {
    const group = grouped.get(message.conversationId) ?? [];
    group.push(message);
    grouped.set(message.conversationId, group);
  }
  const liveParticipants = new Map(
    liveConversations.map((conversation) => [
      conversation.id,
      conversation.participants.map((participant) => participant.playerId),
    ]),
  );
  return [...grouped.entries()]
    .map(([conversationId, group]) => {
      const participantIds = liveParticipants.get(conversationId) ?? [
        ...new Set(group.map((message) => message.author)),
      ];
      const participantNames = participantIds.map((id) => names.get(id) ?? '居民');
      const ordered = [...group].sort((left, right) => left._creationTime - right._creationTime);
      return {
        conversationId,
        participantNames,
        summary: summarizeConversation(participantNames, ordered.map((message) => message.text)),
        updatedAt: Math.max(...group.map((message) => message._creationTime)),
        messages: ordered.slice(-6).map((message) => ({
          authorName: names.get(message.author) ?? '居民',
          text: message.text,
          createdAt: message._creationTime,
        })),
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 6);
}

function summarizeConversation(participantNames: string[], messages: string[]) {
  const combined = messages.join('');
  const topics = [
    [/河|水位|航道|渡口/, '河道水位'],
    [/灯|灯塔|火光|灯架/, '灯火装置'],
    [/花|草药|根系|枯萎/, '花木生长'],
    [/机关|齿轮|结构|零件/, '机关结构'],
    [/金贝|寻宝|比赛|线索/, '寻宝赛事'],
  ]
    .filter(([pattern]) => (pattern as RegExp).test(combined))
    .map(([, label]) => label as string)
    .slice(0, 3);
  const latest = cleanDialogue(messages.at(-1) ?? '').slice(0, 54);
  const subject = topics.length > 0 ? topics.join('、') : '近日见闻';
  return `${participantNames.join('与')}围绕${subject}交换了${messages.length}条信息，最新线索是“${latest}${latest.length >= 54 ? '…' : ''}”。`;
}

function cleanDialogue(text: string) {
  return text
    .replace(/（[^）]*）/g, ' ')
    .replace(/[“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildResidentActivity(
  players: Array<{
    id: string;
    pathfinding?: { destination: { x: number; y: number }; state: { kind: string } };
    activity?: { description: string; emoji?: string; until: number };
  }>,
  conversations: Array<{
    id: string;
    isTyping?: { playerId: string };
    participants: Array<{ playerId: string; status: { kind: string } }>;
  }>,
  names: Map<string, string>,
) {
  return players.map((player) => {
    const conversation = conversations.find((entry) =>
      entry.participants.some((participant) => participant.playerId === player.id),
    );
    if (conversation) {
      const partnerIds = conversation.participants
        .map((participant) => participant.playerId)
        .filter((id) => id !== player.id);
      const member = conversation.participants.find(
        (participant) => participant.playerId === player.id,
      );
      const status = conversation.isTyping?.playerId === player.id
        ? '正在发言'
        : member?.status.kind === 'walkingOver'
          ? '正在赴约'
          : '交谈中';
      return {
        residentId: player.id,
        displayName: names.get(player.id) ?? '居民',
        status,
        detail: `与 ${partnerIds.map((id) => names.get(id) ?? '居民').join('、')} 相处`,
      };
    }
    if (player.pathfinding) {
      return {
        residentId: player.id,
        displayName: names.get(player.id) ?? '居民',
        status: '赶路中',
        detail: `前往坐标 ${player.pathfinding.destination.x}, ${player.pathfinding.destination.y}`,
      };
    }
    return {
      residentId: player.id,
      displayName: names.get(player.id) ?? '居民',
      status: '生活中',
      detail: player.activity
        ? `${player.activity.emoji ?? '•'} ${player.activity.description}`
        : '观察小镇，等待下一次行动',
    };
  });
}

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
  if (!world || world.agents.length < 8) {
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
  if (playerDescriptions.length < 8 || agentDescriptions.length < 8) {
    return { created: false, reason: '等待八位居民资料同步' };
  }
  const playerById = new Map(playerDescriptions.map((entry) => [entry.playerId, entry]));
  const agentById = new Map(agentDescriptions.map((entry) => [entry.agentId, entry]));
  // The inaugural challenge remains the original eight-person event even after
  // more residents join normal town life.
  const residents = world.agents.slice(0, 8).map((agent) => {
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
      playerId: parseGameId('players', participant.residentId),
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
