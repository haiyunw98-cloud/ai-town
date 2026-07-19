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
import { institutions } from '../data/worlds/lighthouse-town/economy';
import { requestEventDecision } from './events/model';
import { fallbackDailyTheme, requestDailyTheme } from './events/dailyTheme';
import { dailyEventTemplates } from './events/dailyTemplates';
import {
  dailyEventAction,
  selectDailyTemplate,
  shanghaiEventDayKey,
} from './events/dailySchedule';
import {
  buildDailyEventDraft,
  buildMissedDailyEventDraft,
  archiveInterruptedDailyDraft,
  restoreDailyEventState,
  serializeDailyEventState,
  type DailyEventDraft,
  type PersistedDailyEvent,
  type PersistedDailyLog,
  type PersistedDailyParticipant,
} from './events/dailyPersistence';
import { advanceDailyEventToStage } from './events/dailyStateMachine';
import { settleDailyEventRewards } from './townEconomy';
import { advanceEvent, createInitialEvent } from './events/stateMachine';
import { EventPhase, TownEventState } from './events/types';
import {
  hasMeaningfulConversationText,
  sanitizeConversationText,
  segmentConversationGraphemes,
  splitConversationClauses,
} from './util/conversationText';

const EVENT_NAME = '灯塔镇百万金贝寻宝赛';
const OBSERVER_SNAPSHOT_LIMIT = 500;

export function boundObserverRows<T>(rows: readonly T[], limit = OBSERVER_SNAPSHOT_LIMIT) {
  return {
    rows: rows.slice(0, limit),
    truncation: { truncated: rows.length > limit, omittedAtLeast: rows.length > limit ? 1 : 0 },
  };
}

export function isObserverIntervention(
  humanPlayerIds: ReadonlySet<string>,
  authorId: string,
) {
  return humanPlayerIds.has(authorId);
}

export function collectHumanPlayerIds(
  currentPlayers: ReadonlyArray<{ id: string; human?: string }>,
  archivedPlayers: ReadonlyArray<{ id: string; human?: string }>,
) {
  return new Set(
    [...currentPlayers, ...archivedPlayers]
      .filter((player) => !!player.human)
      .map((player) => player.id),
  );
}

export const ensureFirstEvent = mutation({
  args: {},
  handler: async (ctx) => {
    return await advanceDailyTownActivity(ctx, Date.now());
  },
});

export const advanceActiveEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await advanceDailyTownActivity(ctx, Date.now());
  },
});

export async function advanceDailyTownActivity(ctx: MutationCtx, now: number) {
  const defaults = await ctx.db
    .query('worldStatus')
    .withIndex('isDefault', (q) => q.eq('isDefault', true))
    .take(2);
  if (defaults.length === 0) return { kind: 'none' as const, reason: 'world-not-ready' };
  if (defaults.length !== 1) throw new Error('Default world status is ambiguous.');
  const worldStatus = defaults[0];
  const dayKey = shanghaiEventDayKey(now);
  const runningRows = await ctx.db
    .query('townEvents')
    .withIndex('worldStatusDay', (q) =>
      q.eq('worldId', worldStatus.worldId).eq('status', 'running'),
    )
    .take(4);
  if (runningRows.length === 4) {
    throw new Error('Running daily event lookup exceeded its safe bound.');
  }
  const interrupted = selectInterruptedCrossDayEvent(runningRows, dayKey);
  if (interrupted) {
    await archiveInterruptedCrossDayEvent(
      ctx, interrupted._id, worldStatus.worldId, now,
    );
  }
  const today = await ctx.db
    .query('townEvents')
    .withIndex('worldDay', (q) => q.eq('worldId', worldStatus.worldId).eq('dailyKey', dayKey))
    .take(2);
  if (today.length > 1) throw new Error(`Daily event collision for ${dayKey}.`);
  const existing = today[0];
  const action = dailyEventAction(
    now,
    worldStatus.status,
    existing
      ? {
          dayKey,
          status: existing.status === 'completed' ? 'completed' : 'running',
          stageIndex: existing.stageIndex ?? 0,
        }
      : null,
  );
  if (action.kind === 'none') return action;

  if (action.kind === 'record-missed') {
    const draft = buildMissedDailyEventDraft(
      String(worldStatus.worldId), dayKey, worldStatus.status, now,
    );
    await insertDailyDraft(ctx, worldStatus.worldId, draft);
    return { kind: 'record-missed' as const, dayKey };
  }
  if (action.kind === 'archive-paused') {
    if (!existing?.dailyKey) throw new Error('Cannot pause-archive a legacy event.');
    await archivePausedDailyEvent(ctx, existing._id, worldStatus.worldId, dayKey, now);
    return { kind: 'archive-paused' as const, dayKey };
  }
  if (action.kind === 'create') {
    const roster = await loadConfiguredDailyRoster(ctx, worldStatus.worldId);
    const recent = await ctx.db
      .query('townEvents')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .order('desc')
      .take(20);
    const previousTemplateIds = recent
      .flatMap((event) => event.dailyKey && event.templateId && event.templateId !== 'none'
        ? [event.templateId]
        : [])
      .slice(0, 6);
    const templateId = selectDailyTemplate(dayKey, previousTemplateIds);
    const template = dailyEventTemplates.find((entry) => entry.id === templateId);
    if (!template) throw new Error(`Missing daily event template: ${templateId}`);
    const startedAt = Date.parse(`${dayKey}T04:00:00.000Z`);
    const draft = buildDailyEventDraft({
      worldId: String(worldStatus.worldId),
      dayKey,
      template,
      theme: fallbackDailyTheme(template),
      residents: roster,
      seed: stableDailySeed(`${worldStatus.worldId}:${dayKey}:${template.id}`),
      startedAt,
    });
    const eventId = await insertDailyDraft(ctx, worldStatus.worldId, draft);
    await recordDailyParticipation(ctx, worldStatus.worldId, eventId, draft.participants, now);
    if (action.stageIndex > 0) {
      await advancePersistedDailyEvent(
        ctx, eventId, worldStatus.worldId, action.stageIndex, now, dayKey,
      );
    } else {
      await ctx.scheduler.runAfter(0, internal.events.generateDailyTheme, { eventId });
    }
    await ctx.scheduler.runAfter(0, internal.events.generateNextDecision, {});
    return { kind: 'create' as const, dayKey, eventId, stageIndex: action.stageIndex };
  }
  if (!existing?.dailyKey) throw new Error('Legacy events are archive-only.');
  await advancePersistedDailyEvent(
    ctx, existing._id, worldStatus.worldId, action.stageIndex, now, dayKey,
  );
  return { kind: action.kind, dayKey, eventId: existing._id, stageIndex: action.stageIndex };
}

export function selectInterruptedCrossDayEvent<T extends {
  dailyKey?: string;
  status: string;
}>(rows: readonly T[], currentDayKey: string): T | null {
  const dailyRows = rows.filter((row) => row.status === 'running' && row.dailyKey !== undefined);
  const future = dailyRows.find((row) => row.dailyKey! > currentDayKey);
  if (future) throw new Error(`Future running daily event detected: ${future.dailyKey}`);
  const stale = dailyRows.filter((row) => row.dailyKey! < currentDayKey);
  if (stale.length > 1) throw new Error('Multiple stale daily events are ambiguous.');
  return stale[0] ?? null;
}

export const observerSnapshot = query({
  args: { worldId: v.optional(v.id('worlds')), dayKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const worldStatus = args.worldId
      ? undefined
      : await ctx.db
          .query('worldStatus')
          .withIndex('isDefault', (q) => q.eq('isDefault', true))
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
        dailyEconomyLedger: [],
        institutionStates: [],
        dailyRelationshipChanges: [],
        snapshotTruncation: {},
      };
    }
    const descriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .collect();
    const names = new Map(descriptions.map((entry) => [entry.playerId, entry.name]));
    const world = await ctx.db.get(worldId);
    const archivedPlayers = await ctx.db
      .query('archivedPlayers')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .collect();
    const humanPlayerIds = collectHumanPlayerIds(world?.players ?? [], archivedPlayers);
    const lifeEventRows = boundObserverRows(await ctx.db
      .query('lifeEvents')
      .withIndex('worldTime', (q) => q.eq('worldId', worldId))
      .order('desc')
      .take(OBSERVER_SNAPSHOT_LIMIT + 1));
    const dailyLifeEvents = lifeEventRows.rows
      .map((entry) => ({
        residentId: entry.residentId,
        displayName: names.get(entry.residentId) ?? '居民',
        kind: entry.kind,
        text: entry.text,
        createdAt: entry.createdAt,
      }));
    const messageRows = boundObserverRows(await ctx.db
      .query('messages')
      .filter((q) => q.eq(q.field('worldId'), worldId))
      .order('desc')
      .take(OBSERVER_SNAPSHOT_LIMIT + 1));
    const messages = messageRows.rows;
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
    const observerNow = Date.now();
    const observerDayKey = resolveObserverDayKey(args.dayKey, observerNow);
    const institutionNames = new Map<string, string>(
      institutions.map((institution) => [institution.id, institution.name]),
    );
    const economyRows = boundObserverRows(await ctx.db
      .query('economyLedger')
      .withIndex('day', (q) => q.eq('worldId', worldId).eq('dayKey', observerDayKey))
      .order('asc')
      .take(OBSERVER_SNAPSHOT_LIMIT + 1));
    const dailyEconomyLedger = economyRows.rows
      .filter((entry) => shanghaiDayKey(entry.createdAt) === observerDayKey)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((entry) => ({
        idempotencyKey: entry.idempotencyKey,
        residentId: entry.residentId,
        residentName: entry.residentId ? names.get(entry.residentId) ?? '居民' : undefined,
        institutionId: entry.institutionId,
        institutionName: entry.institutionId
          ? institutionNames.get(entry.institutionId) ?? entry.institutionId
          : undefined,
        kind: entry.kind,
        amount: entry.amount,
        expectedAmount: entry.expectedAmount,
        compensationKind: entry.compensationKind,
        item: entry.item,
        quantity: entry.quantity,
        sourceKey: entry.sourceKey,
        text: entry.text,
        createdAt: entry.createdAt,
      }));
    // Institution state has a smaller display cap; the 51st row is its sentinel.
    const institutionRows = boundObserverRows(await ctx.db
      .query('townInstitutions')
      .withIndex('world', (q) => q.eq('worldId', worldId))
      .take(51), 50);
    const institutionStates = institutionRows.rows
      .filter((state) =>
        state.dayKey === observerDayKey && shanghaiDayKey(state.updatedAt) === observerDayKey,
      )
      .sort((left, right) => left.updatedAt - right.updatedAt || left.institutionId.localeCompare(right.institutionId))
      .map((state) => ({
        institutionId: state.institutionId,
        institutionName: institutionNames.get(state.institutionId) ?? state.institutionId,
        cash: state.cash,
        todayIncome: state.todayIncome,
        todayExpense: state.todayExpense,
        visitorCount: state.visitorCount,
        dayKey: state.dayKey,
        updatedAt: state.updatedAt,
      }));
    const relationshipRows = boundObserverRows(await ctx.db
      .query('relationshipChanges')
      .withIndex('worldDay', (q) => q.eq('worldId', worldId).eq('dayKey', observerDayKey))
      .order('asc')
      .take(OBSERVER_SNAPSHOT_LIMIT + 1));
    const dailyRelationshipChanges = relationshipRows.rows
      .filter((change) => shanghaiDayKey(change.createdAt) === observerDayKey)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((change) => ({
        idempotencyKey: change.idempotencyKey,
        residentA: change.residentA,
        residentAName: names.get(change.residentA) ?? '居民',
        residentB: change.residentB,
        residentBName: names.get(change.residentB) ?? '居民',
        kind: change.kind,
        friendshipDelta: change.friendshipDelta,
        trustDelta: change.trustDelta,
        attractionDelta: change.attractionDelta,
        businessDelta: change.businessDelta,
        sourceKey: change.sourceKey,
        text: change.text,
        createdAt: change.createdAt,
      }));
    const conversations = groupConversationMessages(messages, names,
      world?.conversations ?? [],
      observerNow,
      observerDayKey,
    );
    const residentActivity = buildResidentActivity(world?.players ?? [], world?.conversations ?? [], names);
    const snapshotTruncation = {
      dailyLifeEvents: lifeEventRows.truncation,
      dailyMessages: messageRows.truncation,
      dailyEconomyLedger: economyRows.truncation,
      institutionStates: institutionRows.truncation,
      dailyRelationshipChanges: relationshipRows.truncation,
    };
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
        dailyEconomyLedger,
        institutionStates,
        dailyRelationshipChanges,
        snapshotTruncation,
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
      .take(10);
    const logs = await ctx.db
      .query('eventLog')
      .withIndex('eventId', (q) => q.eq('eventId', event._id))
      .order('desc')
      .take(30);
    return {
      event: {
        id: event._id,
        name: event.dailyKey ? event.eventName ?? '灯塔镇每日活动' : EVENT_NAME,
        status: event.status,
        phase: event.phase,
        phaseEndsAt: event.phaseEndsAt,
        winnerId: event.winnerId,
        prize: event.dailyKey
          ? '参与 10 金贝；进入前四名加 20 金贝；冠军再加 50 金贝'
          : '一百万金贝＋灯塔湖畔宅院使用权＋下一届灯塔节命名权',
        dailyKey: event.dailyKey,
        templateId: event.templateId,
        announcement: event.announcement,
        venueMode: event.venueMode,
        stageIndex: event.stageIndex,
        endedAt: event.endedAt,
        archiveReason: event.archiveReason,
      },
      participants: participants
        .map(({ residentId, displayName, score, shells, active, role, rank, quote,
          teamId, reachedFinal, choiceId, decisionStage }) => ({
          residentId,
          displayName,
          score,
          shells,
          active,
          role,
          rank,
          quote,
          teamId,
          reachedFinal,
          choiceId,
          decisionStage,
        }))
        .sort((left, right) => (left.rank ?? 99) - (right.rank ?? 99)),
      logs,
      conversations,
      residentActivity,
      dailyLifeEvents,
      dailyMessages,
      dailyEconomyLedger,
      institutionStates,
      dailyRelationshipChanges,
      snapshotTruncation,
    };
  },
});

export function groupConversationMessages(
  messages: Array<{ conversationId: string; author: string; text: string; _creationTime: number }>,
  names: Map<string, string>,
  liveConversations: Array<{ id: string; participants: Array<{ playerId: string }> }>,
  now = Date.now(),
  requestedDayKey?: string,
) {
  const dayKey = resolveObserverDayKey(requestedDayKey, now);
  const currentDayMessages = messages.filter((message) =>
    shanghaiDayKey(message._creationTime) === dayKey,
  );
  const grouped = new Map<string, typeof messages>();
  for (const message of currentDayMessages) {
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

export function summarizeConversation(participantNames: string[], messages: string[]) {
  const dailySegments = messages.flatMap((message) =>
    splitConversationClauses(sanitizeConversationText(message))
      .flatMap(removeLegacyObserverContent)
      .filter(hasMeaningfulConversationText),
  );
  if (dailySegments.length === 0) return '暂无新的日常记录';

  const combined = dailySegments.join('；');
  const dailyTopicLabels = [
    ['劳动', /工作|上课|备课|修理|送货|坐诊/u],
    ['商业', /买|卖|订单|工资|采购|账目|生意/u],
    ['饮食', /吃|饭|茶|点心|粥|面/u],
    ['照护', /照顾|看病|休息|健康/u],
    ['友情与关系', /朋友|约会|关心|误会|合作|邻里/u],
    ['公共生活', /集市|书院|药庐|茶庄|镇公所|食肆/u],
  ] as const;
  const topics = dailyTopicLabels
    .filter(([, pattern]) => pattern.test(combined))
    .map(([label]) => label);
  const factGraphemes = segmentConversationGraphemes(combined);
  const factExcerpt = factGraphemes.slice(0, 80).join('');
  const fact = `${factExcerpt}${factGraphemes.length > 80 ? '…' : '。'}`;
  const residents = participantNames.join('与') || '居民';
  return topics.length > 0
    ? `${residents}聊到${topics.join('、')}：${fact}`
    : `${residents}聊了今天的日常：${fact}`;
}

const observerLegacyPatterns = [
  /海面|海潮|潮汐|观潮|航标|海风|海浪|夜航|失落航路|无海航路|异常闪光|灯塔谜|机关谜|线索交汇|雾潮|灯塔导航/u,
  /\bocean(?:ic)?[\s/-]+(?:tides?|beacons?|navigation|navigational|waves?|breeze|surface)\b/iu,
  /\bsea[\s/-]+(?:beacons?|navigation|navigational|voyage|route|waves?|breeze)\b/iu,
  /\blighthouse[\s/-]+(?:myster(?:y|ies)|navigation|navigational)\b/iu,
  /旧(?:记录|档案|赛事)|历史(?:记录|档案)|往届|异变|谜团|谜题|失踪|河道线索|花木线索|机关线索|灯塔线索|最新线索|关键线索|追查(?:河道|灯塔|机关|花木)/u,
  /寻宝(?:赛|比赛|竞赛)(?:已经|已)?结束/u,
  /(?:一?百万|100万|1(?:[,，]000){2})(?:枚)?金贝/u,
  /\bmillion[\s-]+(?:gold(?:en)?[\s-]+)?shells?\b/iu,
] as const;
const dailyTransition = /今天|今日|现在|随后|之后|接着|然后/u;
const dailyFactMarker = /今天|今日|现在|随后|之后|接着|然后|工作|上课|备课|修理|送货|坐诊|买|卖|订单|工资|采购|账目|生意|吃|饭|茶|点心|粥|面|照顾|看病|休息|健康|朋友|约会|关心|误会|合作|邻里|集市|书院|药庐|茶庄|镇公所|食肆/u;

function firstLegacyObserverMatch(text: string) {
  return observerLegacyPatterns
    .flatMap((pattern) => {
      const match = text.match(pattern);
      return match?.index === undefined ? [] : [{ index: match.index, text: match[0] }];
    })
    .sort((left, right) => left.index - right.index)[0];
}

function isLegacyObserverContent(text: string) {
  return firstLegacyObserverMatch(text) !== undefined;
}

function removeLegacyObserverContent(segment: string): string[] {
  const legacy = firstLegacyObserverMatch(segment);
  if (!legacy) return [segment];

  const dailyParts: string[] = [];
  const prefix = segment
    .slice(0, legacy.index)
    .replace(/(?:后)?(?:聊起|提到|说起|谈到|谈及)\s*$/u, '')
    .trim();
  if (
    dailyFactMarker.test(prefix)
    && hasMeaningfulConversationText(prefix)
    && !isLegacyObserverContent(prefix)
  ) {
    dailyParts.push(prefix);
  }

  const afterLegacy = segment.slice(legacy.index + legacy.text.length);
  const transitionIndex = afterLegacy.search(dailyTransition);
  if (transitionIndex >= 0) {
    const suffix = afterLegacy.slice(transitionIndex).trim();
    if (hasMeaningfulConversationText(suffix) && !isLegacyObserverContent(suffix)) {
      dailyParts.push(suffix);
    }
  }
  return dailyParts;
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function resolveObserverDayKey(requestedDayKey: string | undefined, now = Date.now()) {
  const currentDayKey = shanghaiDayKey(now);
  return requestedDayKey === currentDayKey ? requestedDayKey : currentDayKey;
}

function shanghaiDayKey(timestamp: number) {
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function buildResidentActivity(
  players: Array<{
    id: string;
    human?: string;
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
    const observerControlled = !!player.human;
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
        observerControlled,
        status,
        detail: `与 ${partnerIds.map((id) => names.get(id) ?? '居民').join('、')} 相处`,
      };
    }
    if (player.pathfinding) {
      return {
        residentId: player.id,
        displayName: names.get(player.id) ?? '居民',
        observerControlled,
        status: '赶路中',
        detail: `前往坐标 ${player.pathfinding.destination.x}, ${player.pathfinding.destination.y}`,
      };
    }
    return {
      residentId: player.id,
      displayName: names.get(player.id) ?? '居民',
      observerControlled,
      status: '生活中',
      detail: player.activity
        ? `${player.activity.emoji ?? '•'} ${player.activity.description}`
        : '观察小镇，等待下一次行动',
    };
  });
}

async function loadConfiguredDailyRoster(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const world = await ctx.db.get(worldId);
  if (!world) throw new Error('Daily event world is missing.');
  const [players, agents] = await Promise.all([
    ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .take(33),
    ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .take(33),
  ]);
  if (players.length === 33 || agents.length === 33) {
    throw new Error('Daily event description lookup exceeded its safe bound.');
  }
  return selectConfiguredAiRoster(world, players, agents);
}

export function selectConfiguredAiRoster(
  world: {
    players: ReadonlyArray<{ id: string; human?: string }>;
    agents: ReadonlyArray<{ id: string; playerId: string }>;
  },
  playerDescriptions: ReadonlyArray<{
    playerId: string; name: string; description: string;
  }>,
  agentDescriptions: ReadonlyArray<{ agentId: string; identity: string }>,
) {
  if (world.agents.length !== 9) {
    throw new Error('Daily event requires exactly nine active AI agents.');
  }
  return world.agents.map((agent) => {
    const runtimePlayers = world.players.filter((player) => player.id === agent.playerId);
    const players = playerDescriptions.filter((player) => player.playerId === agent.playerId);
    const agents = agentDescriptions.filter((description) => description.agentId === agent.id);
    if (
      runtimePlayers.length !== 1 || runtimePlayers[0].human !== undefined
      || players.length !== 1 || agents.length !== 1
      || players[0].description !== agents[0].identity
    ) {
      throw new Error(`Daily event AI mapping is ambiguous: ${agent.playerId}`);
    }
    return {
      residentId: agent.playerId,
      displayName: players[0].name,
      identity: agents[0].identity,
    };
  });
}

export function selectDailyStateLogs<T extends { eventKey: string; sequence: number }>(
  rows: readonly T[],
  dayKey: string,
) {
  const prefix = `daily:${dayKey}:`;
  return rows
    .filter((entry) =>
      entry.eventKey === `${prefix}announcement`
      || entry.eventKey === `${prefix}return`
      || new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}stage:\\d+$`, 'u')
        .test(entry.eventKey),
    )
    .sort((left, right) => left.sequence - right.sequence);
}

async function insertDailyDraft(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  draft: DailyEventDraft,
) {
  const { worldId: _draftWorldId, ...event } = draft.event;
  const eventId = await ctx.db.insert('townEvents', { ...event, worldId });
  for (const participant of draft.participants) {
    await ctx.db.insert('eventParticipants', { eventId, ...participant });
  }
  for (const entry of draft.logs) await ctx.db.insert('eventLog', { eventId, ...entry });
  return eventId;
}

async function loadPersistedDailyDraft(ctx: MutationCtx, eventId: Id<'townEvents'>) {
  const event = await ctx.db.get(eventId);
  if (!event || !event.dailyKey || !event.templateId || event.templateId === 'none') {
    throw new Error('Legacy or missed events cannot enter daily event progression.');
  }
  if (
    event.stageIndex === undefined || event.eventName === undefined
    || event.announcement === undefined || event.venueMode === undefined
    || event.startedAt === undefined || event.themeSource === undefined
    || (event.status !== 'running' && event.status !== 'completed')
  ) {
    throw new Error('Persisted daily event fields are incomplete.');
  }
  const [participantDocs, logDocs] = await Promise.all([
    ctx.db.query('eventParticipants').withIndex('eventId', (q) => q.eq('eventId', eventId)).take(10),
    ctx.db.query('eventLog').withIndex('eventId', (q) => q.eq('eventId', eventId)).take(51),
  ]);
  if (participantDocs.length !== 9 || logDocs.length === 51) {
    throw new Error('Persisted daily event rows are incomplete or unbounded.');
  }
  const persistedEvent: PersistedDailyEvent = {
    worldId: String(event.worldId),
    dailyKey: event.dailyKey,
    templateId: event.templateId,
    eventName: event.eventName,
    announcement: event.announcement,
    venueMode: event.venueMode,
    startedAt: event.startedAt,
    endedAt: event.endedAt,
    archiveReason: event.archiveReason,
    stageIndex: event.stageIndex,
    themeSource: event.themeSource,
    status: event.status,
    phase: event.phase,
    seed: event.seed,
    phaseEndsAt: event.phaseEndsAt,
    winnerId: event.winnerId,
    updatedAt: event.updatedAt,
  };
  const participants: PersistedDailyParticipant[] = participantDocs.map((participant) => {
    if (!participant.teamId || participant.reachedFinal === undefined) {
      throw new Error(`Daily event participant fields are incomplete: ${participant.residentId}`);
    }
    return {
      residentId: participant.residentId,
      displayName: participant.displayName,
      identity: participant.identity,
      score: participant.score,
      shells: participant.shells,
      active: participant.active,
      role: participant.role,
      teamId: participant.teamId,
      reachedFinal: participant.reachedFinal,
      quote: participant.quote,
      choiceId: participant.choiceId,
      decisionStage: participant.decisionStage,
    };
  });
  const stateLogDocs = selectDailyStateLogs(logDocs, event.dailyKey);
  if (stateLogDocs.length === 0 || stateLogDocs.length > 8) {
    throw new Error('Persisted daily state logs are incomplete or unbounded.');
  }
  const logs: PersistedDailyLog[] = stateLogDocs.map((entry) => {
    if (entry.stageIndex === undefined) throw new Error('Daily event log stage is missing.');
    return {
      eventKey: entry.eventKey,
      sequence: entry.sequence,
      stageIndex: entry.stageIndex,
      kind: entry.kind,
      text: entry.text,
      createdAt: entry.createdAt,
    };
  });
  return { event: persistedEvent, participants, logs };
}

async function applyDailyDraft(
  ctx: MutationCtx,
  eventId: Id<'townEvents'>,
  draft: DailyEventDraft,
) {
  const { worldId: _draftWorldId, ...event } = draft.event;
  await ctx.db.patch(eventId, event);
  const docs = await ctx.db
    .query('eventParticipants')
    .withIndex('eventId', (q) => q.eq('eventId', eventId))
    .take(10);
  if (docs.length !== draft.participants.length) {
    throw new Error('Daily event participant persistence changed during advancement.');
  }
  for (const participant of draft.participants) {
    const doc = docs.find((entry) => entry.residentId === participant.residentId);
    if (!doc) throw new Error(`Daily event participant disappeared: ${participant.residentId}`);
    await ctx.db.patch(doc._id, participant);
  }
  for (const entry of draft.logs) {
    const matches = await ctx.db
      .query('eventLog')
      .withIndex('eventKey', (q) => q.eq('eventId', eventId).eq('eventKey', entry.eventKey))
      .take(2);
    if (matches.length > 1) throw new Error(`Daily event log collision: ${entry.eventKey}`);
    if (!matches[0]) await ctx.db.insert('eventLog', { eventId, ...entry });
  }
}

async function advancePersistedDailyEvent(
  ctx: MutationCtx,
  eventId: Id<'townEvents'>,
  worldId: Id<'worlds'>,
  targetStageIndex: number,
  now: number,
  dayKey: string,
) {
  const draft = await loadPersistedDailyDraft(ctx, eventId);
  if (draft.event.dailyKey !== dayKey || draft.event.status === 'completed') return;
  const state = restoreDailyEventState(draft.event, draft.participants, draft.logs);
  const decisions = Object.fromEntries(
    draft.participants.flatMap((participant) =>
      participant.decisionStage === state.stageIndex && participant.choiceId
        ? [[participant.residentId, participant.choiceId]]
        : []),
  );
  const next = advanceDailyEventToStage(state, targetStageIndex, now, decisions);
  if (next === state) return;
  const persisted = serializeDailyEventState(draft.event, draft.participants, next, now);
  await applyDailyDraft(ctx, eventId, persisted);
  if (persisted.event.status === 'completed') {
    await settleDailyEventRewards(ctx, { worldId, eventId, dayKey, hostServices: null, now });
    await recordDailyReturn(ctx, worldId, eventId, persisted.participants, now, 'completed');
  } else {
    await ctx.scheduler.runAfter(0, internal.events.generateNextDecision, {});
  }
}

async function archiveInterruptedCrossDayEvent(
  ctx: MutationCtx,
  eventId: Id<'townEvents'>,
  worldId: Id<'worlds'>,
  now: number,
) {
  const draft = await loadPersistedDailyDraft(ctx, eventId);
  const archived = archiveInterruptedDailyDraft(draft, now);
  if (archived === draft) return;
  await applyDailyDraft(ctx, eventId, archived);
  await recordDailyReturn(
    ctx, worldId, eventId, archived.participants, now, 'interrupted-cross-day',
  );
}

async function archivePausedDailyEvent(
  ctx: MutationCtx,
  eventId: Id<'townEvents'>,
  worldId: Id<'worlds'>,
  dayKey: string,
  now: number,
) {
  const draft = await loadPersistedDailyDraft(ctx, eventId);
  if (draft.event.dailyKey !== dayKey || draft.event.status === 'completed') return;
  const text = '活动因小镇暂停而结束，没有发放奖金，居民恢复普通生活。';
  await ctx.db.patch(eventId, {
    status: 'completed', phase: 'paused', phaseEndsAt: now, endedAt: now,
    archiveReason: 'world-paused', winnerId: undefined, updatedAt: now,
  });
  const participantDocs = await ctx.db
    .query('eventParticipants')
    .withIndex('eventId', (q) => q.eq('eventId', eventId))
    .take(10);
  for (const participant of participantDocs) {
    await ctx.db.patch(participant._id, { active: false, role: 'spectator' });
  }
  const eventKey = `daily:${dayKey}:paused`;
  const duplicate = await ctx.db
    .query('eventLog')
    .withIndex('eventKey', (q) => q.eq('eventId', eventId).eq('eventKey', eventKey))
    .take(2);
  if (duplicate.length > 1) throw new Error(`Daily event log collision: ${eventKey}`);
  if (!duplicate[0]) {
    await ctx.db.insert('eventLog', {
      eventId, eventKey, sequence: draft.logs.length, stageIndex: draft.event.stageIndex,
      kind: 'paused', text, createdAt: now,
    });
  }
  await recordDailyReturn(ctx, worldId, eventId, draft.participants, now, 'world-paused');
}

async function recordDailyParticipation(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  eventId: Id<'townEvents'>,
  participants: readonly PersistedDailyParticipant[],
  now: number,
) {
  for (const participant of participants) {
    await ctx.db.insert('lifeEvents', {
      worldId,
      residentId: parseGameId('players', participant.residentId),
      kind: 'daily-event-participation',
      text: `${participant.displayName}参加了今日安全活动。`,
      createdAt: now,
      sourceKey: `daily-event:${eventId}:${participant.residentId}:participation`,
    });
  }
}

async function recordDailyReturn(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  eventId: Id<'townEvents'>,
  participants: readonly PersistedDailyParticipant[],
  now: number,
  reason: 'completed' | 'world-paused' | 'interrupted-cross-day',
) {
  for (const participant of participants) {
    const sourceKey = `daily-event:${eventId}:${participant.residentId}:return`;
    const existing = await ctx.db
      .query('lifeEvents')
      .withIndex('sourceKey', (q) => q.eq('worldId', worldId).eq('sourceKey', sourceKey))
      .take(2);
    if (existing.length > 1) throw new Error(`Daily return collision: ${sourceKey}`);
    if (!existing[0]) {
      await ctx.db.insert('lifeEvents', {
        worldId,
        residentId: parseGameId('players', participant.residentId),
        kind: 'daily-event-return',
        text: reason === 'completed'
          ? `${participant.displayName}结束活动并恢复普通生活。`
          : reason === 'world-paused'
            ? `${participant.displayName}因小镇暂停结束活动，没有获得奖金，恢复普通生活。`
            : `${participant.displayName}的昨日活动因跨日中断而结束，没有冠军或奖金，现已恢复普通生活。`,
        createdAt: now,
        sourceKey,
      });
    }
  }
  const world = await ctx.db.get(worldId);
  if (!world) throw new Error('Daily event world disappeared during return.');
  const participantIds = new Set(participants.map((participant) => participant.residentId));
  await ctx.db.patch(worldId, {
    players: world.players.map((player) => participantIds.has(player.id)
      ? { ...player, activity: undefined }
      : player),
  });
}

function stableDailySeed(value: string) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export const decisionCandidate = internalQuery({
  args: {},
  handler: async (ctx) => {
    const defaults = await ctx.db
      .query('worldStatus')
      .withIndex('isDefault', (q) => q.eq('isDefault', true))
      .take(2);
    if (defaults.length !== 1 || defaults[0].status !== 'running') return null;
    const dayKey = shanghaiEventDayKey(Date.now());
    const events = await ctx.db
      .query('townEvents')
      .withIndex('worldDay', (q) => q.eq('worldId', defaults[0].worldId).eq('dailyKey', dayKey))
      .take(2);
    if (events.length !== 1) return null;
    const event = events[0];
    const participants = await ctx.db
      .query('eventParticipants')
      .withIndex('eventId', (q) => q.eq('eventId', event._id))
      .take(10);
    if (participants.length !== 9) return null;
    const candidate = selectDailyDecisionCandidate(event, participants);
    if (!candidate) return null;
    return { eventId: event._id, dayKey, ...candidate };
  },
});

export function isDailyThemeSaveEligible(
  event: { dailyKey?: string; status: string; stageIndex?: number; themeSource?: string },
  worldStatus: string,
  dayKey: string,
) {
  return !!event.dailyKey
    && event.dailyKey === dayKey
    && worldStatus === 'running'
    && event.status === 'running'
    && event.stageIndex === 0
    && event.themeSource === 'fallback';
}

export function selectDailyDecisionCandidate(
  event: { dailyKey?: string; templateId?: string; status: string; stageIndex?: number },
  participants: ReadonlyArray<{
    residentId: string;
    displayName: string;
    identity: string;
    active: boolean;
    decisionStage?: number;
  }>,
) {
  if (
    !event.dailyKey || event.status !== 'running'
    || event.stageIndex === undefined || event.stageIndex < 0 || event.stageIndex > 5
  ) return null;
  const template = dailyEventTemplates.find((entry) => entry.id === event.templateId);
  const stage = template?.stages[event.stageIndex];
  if (!stage) return null;
  const candidate = participants.find((entry) =>
    entry.active && entry.decisionStage !== event.stageIndex,
  );
  if (!candidate) return null;
  return {
    residentId: candidate.residentId,
    displayName: candidate.displayName,
    identity: candidate.identity,
    stageIndex: event.stageIndex,
    phase: stage.id,
    choices: stage.choices,
  };
}

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
      choices: candidate.choices,
    });
    await ctx.runMutation(internal.events.saveDecision, {
      eventId: candidate.eventId,
      residentId: candidate.residentId,
      dayKey: candidate.dayKey,
      stageIndex: candidate.stageIndex,
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
    dayKey: v.string(),
    stageIndex: v.number(),
    choiceId: v.string(),
    publicQuote: v.string(),
    source: v.union(v.literal('model'), v.literal('fallback')),
  },
  handler: async (ctx, args) => {
    const defaults = await ctx.db
      .query('worldStatus')
      .withIndex('isDefault', (q) => q.eq('isDefault', true))
      .take(2);
    const event = await ctx.db.get(args.eventId);
    if (
      defaults.length !== 1 || defaults[0].status !== 'running'
      || !event || event.worldId !== defaults[0].worldId
      || event.dailyKey !== args.dayKey || shanghaiEventDayKey(Date.now()) !== args.dayKey
      || event.status !== 'running' || event.stageIndex !== args.stageIndex
    ) return;
    const template = dailyEventTemplates.find((entry) => entry.id === event.templateId);
    const stage = template?.stages[args.stageIndex];
    if (!stage?.choices.some((choice) => choice.id === args.choiceId)) return;
    const participants = await ctx.db
      .query('eventParticipants')
      .withIndex('eventId', (q) => q.eq('eventId', args.eventId))
      .take(10);
    if (participants.length !== 9) return;
    const participant = participants.find((entry) => entry.residentId === args.residentId);
    if (!participant?.active || participant.decisionStage === args.stageIndex) return;
    await ctx.db.patch(participant._id, {
      quote: args.publicQuote,
      choiceId: args.choiceId,
      decisionStage: args.stageIndex,
      decisionPhase: stage.id,
    });
    const eventKey = `daily:${args.dayKey}:decision:${args.stageIndex}:${args.residentId}`;
    const duplicate = await ctx.db
      .query('eventLog')
      .withIndex('eventKey', (q) => q.eq('eventId', args.eventId).eq('eventKey', eventKey))
      .take(2);
    if (duplicate.length > 1) throw new Error(`Daily decision log collision: ${eventKey}`);
    if (!duplicate[0]) {
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
        stageIndex: args.stageIndex,
        text: `${participant.displayName}选择“${args.choiceId}”：${args.publicQuote}`,
        createdAt: Date.now(),
      });
    }
    await ctx.scheduler.runAfter(0, internal.events.generateNextDecision, {});
  },
});

export const dailyThemeCandidate = internalQuery({
  args: { eventId: v.id('townEvents') },
  handler: async (ctx, args) => {
    const defaults = await ctx.db
      .query('worldStatus')
      .withIndex('isDefault', (q) => q.eq('isDefault', true))
      .take(2);
    const event = await ctx.db.get(args.eventId);
    if (!event || defaults.length !== 1 || event.worldId !== defaults[0].worldId) return null;
    const dayKey = shanghaiEventDayKey(Date.now());
    if (!isDailyThemeSaveEligible(event, defaults[0].status, dayKey)) return null;
    const template = dailyEventTemplates.find((entry) => entry.id === event.templateId);
    return template ? { dayKey, template } : null;
  },
});

export const generateDailyTheme = internalAction({
  args: { eventId: v.id('townEvents') },
  handler: async (ctx, args) => {
    const candidate = await ctx.runQuery(internal.events.dailyThemeCandidate, args);
    if (!candidate) return;
    const theme = await requestDailyTheme(candidate.template, candidate.dayKey);
    await ctx.runMutation(internal.events.saveDailyTheme, {
      eventId: args.eventId,
      dayKey: candidate.dayKey,
      name: theme.name,
      announcement: theme.announcement,
      source: theme.source,
    });
  },
});

export const saveDailyTheme = internalMutation({
  args: {
    eventId: v.id('townEvents'),
    dayKey: v.string(),
    name: v.string(),
    announcement: v.string(),
    source: v.union(v.literal('model'), v.literal('fallback')),
  },
  handler: async (ctx, args) => {
    const defaults = await ctx.db
      .query('worldStatus')
      .withIndex('isDefault', (q) => q.eq('isDefault', true))
      .take(2);
    const event = await ctx.db.get(args.eventId);
    if (
      defaults.length !== 1 || !event || event.worldId !== defaults[0].worldId
      || !isDailyThemeSaveEligible(event, defaults[0].status, args.dayKey)
      || shanghaiEventDayKey(Date.now()) !== args.dayKey
    ) return;
    await ctx.db.patch(args.eventId, {
      eventName: args.name,
      announcement: args.announcement,
      themeSource: args.source,
      updatedAt: Date.now(),
    });
    const logs = await ctx.db
      .query('eventLog')
      .withIndex('eventKey', (q) =>
        q.eq('eventId', args.eventId).eq('eventKey', `daily:${args.dayKey}:announcement`),
      )
      .take(2);
    if (logs.length !== 1) throw new Error('Daily announcement log is missing or ambiguous.');
    await ctx.db.patch(logs[0]._id, { text: args.announcement });
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
