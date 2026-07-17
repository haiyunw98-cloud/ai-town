import type { Locale } from '../i18n';
import { lighthouseCharacters } from '../../data/worlds/lighthouse-town/characters';
import { residentLifeProfiles } from '../../data/worlds/lighthouse-town/lives';
import { townLandmarks } from '../../data/worlds/lighthouse-town/map';

export type BroadcastSnapshot = {
  event: null | {
    id: string;
    name: string;
    status: string;
    phase: string;
    phaseEndsAt: number;
    winnerId?: string;
    prize: string;
  };
  participants: Array<{
    residentId: string;
    displayName: string;
    score: number;
    shells: number;
    active: boolean;
    role: string;
    rank?: number;
    quote?: string;
  }>;
  logs: Array<{
    eventKey: string;
    sequence: number;
    kind: string;
    text: string;
    createdAt: number;
  }>;
  conversations: Array<{
    conversationId: string;
    participantNames: string[];
    summary: string;
    updatedAt: number;
    messages: Array<{
      authorName: string;
      text: string;
      createdAt: number;
    }>;
  }>;
  residentActivity: Array<{
    residentId: string;
    displayName: string;
    status: string;
    detail: string;
    observerControlled?: boolean;
  }>;
  dailyMessages: Array<{
    messageId: string;
    conversationId: string;
    authorId: string;
    authorName: string;
    text: string;
    createdAt: number;
    observerIntervention: boolean;
  }>;
  dailyLifeEvents?: Array<{
    residentId: string;
    displayName: string;
    kind: string;
    text: string;
    createdAt: number;
  }>;
};

export type ResolvedSocialNarrative = {
  source: 'model' | 'fallback';
  narrative: string;
};

export async function resolveSocialNarrative(
  generate: () => Promise<unknown>,
): Promise<ResolvedSocialNarrative> {
  try {
    const generated = await generate();
    if (typeof generated !== 'object' || generated === null) {
      return { source: 'fallback', narrative: '' };
    }
    const candidate = generated as Record<string, unknown>;
    if (
      (candidate.source === 'model' || candidate.source === 'fallback')
      && typeof candidate.narrative === 'string'
    ) {
      return { source: candidate.source, narrative: candidate.narrative };
    }
  } catch {
    // A manually requested report always has a deterministic local fallback.
  }
  return { source: 'fallback', narrative: '' };
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function shanghaiDayKey(timestamp: number) {
  const shanghaiDate = new Date(timestamp + SHANGHAI_OFFSET_MS);
  const year = shanghaiDate.getUTCFullYear();
  const month = String(shanghaiDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shanghaiDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const sameLocalDay = (timestamp: number, now: number) =>
  shanghaiDayKey(timestamp) === shanghaiDayKey(now);

const escapeMarkdown = (value: string) => value
  .replace(/\r\n|\r|\n/g, ' / ')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/([\\`*_\[\]{}()#+\-.!|])/g, '\\$1')
  .trim();

type LifeEvent = NonNullable<BroadcastSnapshot['dailyLifeEvents']>[number];
type DailyMessage = BroadcastSnapshot['dailyMessages'][number];
type EventLog = BroadcastSnapshot['logs'][number];

type ReportConversation = {
  conversationId: string;
  participantNames: string[];
  summary: string;
  updatedAt: number;
  messageCount: number;
  messages: DailyMessage[];
};

type DailyReportData = {
  snapshot: BroadcastSnapshot;
  locale: Locale;
  now: number;
  lifeEvents: LifeEvent[];
  dailyMessages: DailyMessage[];
  conversations: ReportConversation[];
  logs: EventLog[];
  residentProfileIdsByRuntimeId: Map<string, string>;
  observerControlledResidentIds: Set<string>;
};

const chronological = <T extends { createdAt: number }>(left: T, right: T) =>
  left.createdAt - right.createdAt;

const missingRecord = ['- 当日无记录'];

function reportSection(title: string, content: string[]) {
  return [`## ${title}`, '', ...(content.length > 0 ? content : missingRecord), ''];
}

function formatReportDate(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
    timeZone: 'Asia/Shanghai',
  }).format(timestamp);
}

function formatReportTime(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZone: 'Asia/Shanghai',
  }).format(timestamp);
}

function reportRecordRange(data: DailyReportData) {
  const timestamps = [
    ...data.lifeEvents.map((event) => event.createdAt),
    ...data.dailyMessages.map((message) => message.createdAt),
    ...data.logs.map((log) => log.createdAt),
  ];
  if (timestamps.length === 0) return '当日无记录';
  return `${formatReportTime(Math.min(...timestamps), data.locale)}–${formatReportTime(Math.max(...timestamps), data.locale)}`;
}

function buildMetadataSection(data: DailyReportData) {
  return reportSection('日报元数据', [
    `- 日期：${formatReportDate(data.now, data.locale)}`,
    `- 生成时间：${formatReportTime(data.now, data.locale)}`,
    `- 本地日期筛选：${formatReportDate(data.now, data.locale)}`,
    `- 记录范围：${reportRecordRange(data)}`,
  ]);
}

function buildOverviewSection(data: DailyReportData) {
  return reportSection('全镇事实概览', [
    `- 居民档案：${residentLifeProfiles.length} 人`,
    `- 当前状态记录：${data.snapshot.residentActivity.filter((entry) => !entry.observerControlled).length} 条`,
    `- 当日生活记录：${data.lifeEvents.length} 条`,
    `- 当日对话：${data.conversations.length} 组`,
    `- 当日原始消息：${data.dailyMessages.length} 条`,
    `- 当日公共事件日志：${data.logs.length} 条`,
  ]);
}

function profileIdForLocalizedName(displayName: string) {
  return lighthouseCharacters.find((character) =>
    character.name['zh-CN'] === displayName || character.name.en === displayName,
  )?.id ?? residentLifeProfiles.find((profile) => profile.name === displayName)?.id;
}

function buildRuntimeResidentProfileMap(snapshot: BroadcastSnapshot) {
  const profileIdsByRuntimeId = new Map<string, string>();
  for (const resident of snapshot.residentActivity) {
    if (resident.observerControlled) continue;
    const profileId = profileIdForLocalizedName(resident.displayName);
    if (profileId) profileIdsByRuntimeId.set(resident.residentId, profileId);
  }
  return profileIdsByRuntimeId;
}

function resolveResidentProfile(data: DailyReportData, residentId: string, displayName: string) {
  if (data.observerControlledResidentIds.has(residentId)) return undefined;
  const profileId = residentLifeProfiles.find((profile) => profile.id === residentId)?.id
    ?? data.residentProfileIdsByRuntimeId.get(residentId)
    ?? profileIdForLocalizedName(displayName);
  return residentLifeProfiles.find((profile) => profile.id === profileId);
}

function matchesResidentProfile(
  data: DailyReportData,
  profileId: string,
  residentId: string,
  displayName: string,
) {
  return resolveResidentProfile(data, residentId, displayName)?.id === profileId;
}

function residentDisplayName(data: DailyReportData, residentId: string, displayName: string) {
  return resolveResidentProfile(data, residentId, displayName)?.name ?? displayName;
}

function residentIdentity(data: DailyReportData, residentId: string, displayName: string) {
  const resolvedName = residentDisplayName(data, residentId, displayName);
  return residentId
    ? `[${escapeMarkdown(residentId)}] ${escapeMarkdown(resolvedName)}`
    : escapeMarkdown(resolvedName);
}

function dailyMessageDisplayName(data: DailyReportData, message: DailyMessage) {
  return message.observerIntervention
    ? '观察者'
    : residentDisplayName(data, message.authorId, message.authorName);
}

function dailyMessageIdentity(data: DailyReportData, message: DailyMessage) {
  if (!message.observerIntervention) {
    return residentIdentity(data, message.authorId, message.authorName);
  }
  return message.authorId
    ? `[${escapeMarkdown(message.authorId)}] 观察者`
    : '观察者';
}

function factualConversationSummary(participantNames: string[], messages: DailyMessage[]) {
  const latestText = messages.at(-1)?.text ?? '';
  const latestExcerpt = latestText.slice(0, 80);
  return `${participantNames.join('、') || '参与者'}；参与者共交换 ${messages.length} 条消息；最新消息：“${latestExcerpt}${latestText.length > 80 ? '…' : ''}”。`;
}

function buildReportConversations(data: DailyReportData) {
  const grouped = new Map<string, DailyMessage[]>();
  for (const message of data.dailyMessages) {
    const messages = grouped.get(message.conversationId) ?? [];
    messages.push(message);
    grouped.set(message.conversationId, messages);
  }
  return [...grouped.entries()].map(
    ([conversationId, messages]) => {
      const participantNames = [...new Set(messages.map((message) =>
        dailyMessageDisplayName(data, message),
      ))];
      return {
        conversationId,
        participantNames,
        summary: factualConversationSummary(participantNames, messages),
        updatedAt: messages.at(-1)?.createdAt ?? data.now,
        messageCount: messages.length,
        messages,
      };
    },
  ).sort((left, right) => left.updatedAt - right.updatedAt);
}

function residentConversationFacts(data: DailyReportData, profileId: string) {
  const residentMessages = data.dailyMessages.filter((message) =>
    !message.observerIntervention
      && matchesResidentProfile(data, profileId, message.authorId, message.authorName),
  );
  const conversationIds = new Set(residentMessages.map((message) => message.conversationId));
  const partnerNames = new Set<string>();
  for (const message of data.dailyMessages) {
    if (!conversationIds.has(message.conversationId)) continue;
    if (message.observerIntervention) {
      partnerNames.add('观察者');
      continue;
    }
    const partner = resolveResidentProfile(data, message.authorId, message.authorName);
    if (partner && partner.id !== profileId) partnerNames.add(partner.name);
  }
  return {
    partnerNames: [...partnerNames],
    representativeQuotes: residentMessages.slice(-3),
  };
}

function buildResidentSection(data: DailyReportData) {
  const lines: string[] = [];
  for (const profile of residentLifeProfiles) {
    const activity = data.snapshot.residentActivity.find((entry) =>
      !entry.observerControlled
        && matchesResidentProfile(data, profile.id, entry.residentId, entry.displayName),
    );
    const events = data.lifeEvents.filter((entry) =>
      matchesResidentProfile(data, profile.id, entry.residentId, entry.displayName),
    );
    const conversationFacts = residentConversationFacts(data, profile.id);
    lines.push(`### ${escapeMarkdown(profile.name)}｜${escapeMarkdown(profile.occupation)}`);
    lines.push('');
    lines.push(`- 居民 ID：${escapeMarkdown(profile.id)}`);
    lines.push(`- [人物设定] 住所：${escapeMarkdown(profile.home)}`);
    lines.push(`- [人物设定] 性格：${profile.personality.map(escapeMarkdown).join('、')}`);
    lines.push(`- [人物设定] 穿着：${escapeMarkdown(profile.outfit)}`);
    lines.push(`- [人物设定] 饮食：${escapeMarkdown(profile.diet)}`);
    lines.push(`- [人物设定] 生计：${escapeMarkdown(profile.business)}`);
    lines.push(`- [人物设定] 当前目标：${escapeMarkdown(profile.currentGoal)}`);
    lines.push(activity
      ? `- [当日事实] 当前状态：${escapeMarkdown(activity.status)}；${escapeMarkdown(activity.detail)}`
      : '- [当日事实] 当前状态：当日无记录');
    lines.push('- [当日事实] 当日活动：');
    if (events.length === 0) {
      lines.push('  - 当日无记录');
    } else {
      for (const event of events) {
        lines.push(`  - ${residentIdentity(data, event.residentId, event.displayName)}｜${escapeMarkdown(event.text)}`);
      }
    }
    lines.push(`- [当日事实] 对话伙伴：${conversationFacts.partnerNames.length > 0
      ? conversationFacts.partnerNames.map(escapeMarkdown).join('、')
      : '当日无记录'}`);
    lines.push(`- [当日事实] 代表发言：${conversationFacts.representativeQuotes.length > 0
      ? conversationFacts.representativeQuotes.map((message) =>
        `${dailyMessageIdentity(data, message)}：“${escapeMarkdown(message.text).slice(0, 100)}”`,
      ).join('；')
      : '当日无记录'}`);
    lines.push('');
  }
  return reportSection('居民逐人记录', lines);
}

function buildRelationshipsSection(data: DailyReportData) {
  const lines = ['### 人物设定关系', ''];
  for (const profile of residentLifeProfiles) {
    for (const relationship of profile.relationships) {
      const target = residentLifeProfiles.find((entry) => entry.id === relationship.targetId);
      lines.push(
        `- ${escapeMarkdown(profile.name)} → ${escapeMarkdown(target?.name ?? relationship.targetId)}｜${escapeMarkdown(relationship.label)}｜${escapeMarkdown(relationship.kind)}｜${relationship.score}/100｜${escapeMarkdown(relationship.summary)}`,
      );
    }
  }
  lines.push('', '### 当日实际互动', '');
  if (data.conversations.length === 0) {
    lines.push('- 当日无记录');
  } else {
    for (const conversation of data.conversations) {
      lines.push(`- ${conversation.participantNames.map(escapeMarkdown).join(' × ')}｜消息 ${conversation.messageCount} 条`);
    }
  }
  return reportSection('关系记录', lines);
}

function buildLandmarksSection(data: DailyReportData) {
  const lines: string[] = [];
  for (const landmark of townLandmarks) {
    const confirmedUses = data.lifeEvents.filter((event) =>
      event.text.includes(`在${landmark.name}`),
    );
    lines.push(`### ${escapeMarkdown(landmark.name)}`);
    lines.push('');
    lines.push(`- 说明：${escapeMarkdown(landmark.description)}`);
    lines.push(`- 开放时间：${escapeMarkdown(landmark.openHours)}`);
    lines.push(`- 服务：${landmark.services.map(escapeMarkdown).join('、')}`);
    lines.push('- 当日确认使用：');
    if (confirmedUses.length === 0) {
      lines.push('  - 当日无记录');
    } else {
      for (const event of confirmedUses) {
        lines.push(`  - ${residentIdentity(data, event.residentId, event.displayName)}｜${escapeMarkdown(event.text)}`);
      }
    }
    lines.push('');
  }
  return reportSection('机构与地点', lines);
}

const activityKindLabels: Record<string, string> = {
  work: '工作',
  conversation: '对话',
  social: '社交',
  memory: '记忆记录',
  travel: '出行',
  meal: '饮食',
  rest: '休息',
  leisure: '休闲',
  purchase: '采买',
  health: '健康',
  event: '公共活动',
};

function buildActivityClassificationSection(data: DailyReportData) {
  if (data.lifeEvents.length === 0) return reportSection('活动分类', []);
  const grouped = new Map<string, LifeEvent[]>();
  for (const event of data.lifeEvents) {
    const label = activityKindLabels[event.kind] ?? '其他';
    const events = grouped.get(label) ?? [];
    events.push(event);
    grouped.set(label, events);
  }
  const lines: string[] = [];
  for (const [label, events] of grouped) {
    lines.push(`### ${label}`, '');
    for (const event of events) {
      lines.push(`- ${residentIdentity(data, event.residentId, event.displayName)}｜${escapeMarkdown(event.text)}`);
    }
    lines.push('');
  }
  return reportSection('活动分类', lines);
}

function conversationExcerptMessages(conversation: ReportConversation) {
  return conversation.messages.slice(-4);
}

function buildConversationsSection(data: DailyReportData) {
  const lines: string[] = [];
  for (const conversation of data.conversations) {
    lines.push(`### ${conversation.participantNames.map(escapeMarkdown).join(' × ')}`, '');
    lines.push(`- 摘要：${escapeMarkdown(conversation.summary)}`);
    const excerpts = conversationExcerptMessages(conversation).map(
      (message) => `${dailyMessageIdentity(data, message)}：“${escapeMarkdown(message.text).slice(0, 100)}”`,
    );
    lines.push(excerpts.length > 0 ? `- 对话摘录：${excerpts.join('；')}` : '- 对话摘录：当日无记录');
    lines.push('');
  }
  return reportSection('当日对话', lines);
}

function buildPublicEventsSection(data: DailyReportData) {
  const lines: string[] = [];
  if (data.snapshot.event) {
    const event = data.snapshot.event;
    const winner = data.snapshot.participants.find(
      (participant) => participant.residentId === event.winnerId,
    );
    lines.push(`- 赛事：${escapeMarkdown(event.name)}`);
    lines.push(`- 状态：${escapeMarkdown(event.status)}`);
    lines.push(`- 阶段：${escapeMarkdown(event.phase)}`);
    if (event.winnerId) lines.push(`- 冠军：${escapeMarkdown(winner?.displayName ?? event.winnerId)}`);
    lines.push(`- 奖励：${escapeMarkdown(event.prize)}`);
    if (data.logs.length === 0) lines.push('- 状态来源：赛事状态（非当日事件记录）');
  }
  if (data.logs.length > 0) {
    lines.push('', '### 当日日志', '');
    for (const log of data.logs) {
      lines.push(`- [${escapeMarkdown(log.eventKey)}#${log.sequence}] ${escapeMarkdown(log.text)}`);
    }
  }
  return reportSection('赛事与公共事件', lines);
}

function buildLifeAppendixSection(data: DailyReportData) {
  return reportSection('生活记录附录', data.lifeEvents.map((event) =>
    `- ${event.createdAt}｜${residentIdentity(data, event.residentId, event.displayName)}｜${activityKindLabels[event.kind] ?? '其他'}｜${escapeMarkdown(event.text)}`,
  ));
}

function buildRawMessagesSection(data: DailyReportData) {
  return reportSection('原始对话附录', data.dailyMessages.map((message) => {
    const observerLabel = message.observerIntervention ? '｜观察者介入' : '';
    return `- ${message.createdAt}｜${dailyMessageIdentity(data, message)}${observerLabel}｜${escapeMarkdown(message.text)}`;
  }));
}

function buildDataNotesSection() {
  return reportSection('数据说明', [
    '- 人物档案、人物设定关系与机构资料属于设定内容；设定内容不属于当日事实。',
    '- 缺失项统一标记为“当日无记录”，不补全缺失事实。',
    '- 本日报仅转录输入快照中的状态、记录、摘要与日志，不推断原因或动机。',
  ]);
}

export function buildDailyReport(
  snapshot: BroadcastSnapshot,
  locale: Locale,
  now = Date.now(),
) {
  const data: DailyReportData = {
    snapshot,
    locale,
    now,
    lifeEvents: (snapshot.dailyLifeEvents ?? [])
      .filter((event) => sameLocalDay(event.createdAt, now))
      .sort(chronological),
    dailyMessages: snapshot.dailyMessages
      .filter((message) => sameLocalDay(message.createdAt, now))
      .sort(chronological),
    conversations: [],
    logs: snapshot.logs
      .filter((entry) => entry.kind !== 'conversation' && sameLocalDay(entry.createdAt, now))
      .sort(chronological),
    residentProfileIdsByRuntimeId: buildRuntimeResidentProfileMap(snapshot),
    observerControlledResidentIds: new Set(
      snapshot.residentActivity
        .filter((entry) => entry.observerControlled)
        .map((entry) => entry.residentId),
    ),
  };
  data.conversations = buildReportConversations(data);
  const lines = [
    '# 灯塔镇完整观察日报',
    '',
    ...buildMetadataSection(data),
    ...buildOverviewSection(data),
    ...buildResidentSection(data),
    ...buildRelationshipsSection(data),
    ...buildLandmarksSection(data),
    ...buildActivityClassificationSection(data),
    ...buildConversationsSection(data),
    ...buildPublicEventsSection(data),
    ...buildLifeAppendixSection(data),
    ...buildRawMessagesSection(data),
    ...buildDataNotesSection(),
  ];
  return lines.join('\n');
}

export function buildTownStory(conversations: BroadcastSnapshot['conversations']) {
  return {
    headline: '今日灯塔镇',
    bullets: conversations
      .filter((conversation) => conversation.summary !== '暂无新的日常记录')
      .slice(0, 4).map(
      (conversation) => `${conversation.participantNames.join(' × ')}｜${conversation.summary}`,
    ),
  };
}

const phaseLabels: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    announcement: '全镇公告',
    treasureHunt: '八人寻宝冲刺',
    lanternRelay: '双人灯火接力',
    secretTrade: '四人秘密交易',
    lighthouseFinal: '灯塔点灯决赛',
    awards: '百万金贝颁奖礼',
  },
  en: {
    announcement: 'Town Announcement',
    treasureHunt: 'Eight-Person Treasure Hunt',
    lanternRelay: 'Lantern Relay',
    secretTrade: 'Secret Trade',
    lighthouseFinal: 'Lighthouse Final',
    awards: 'Million-Shell Awards',
  },
};

export function buildCompletedArchiveView(title: string, champion: string, locale: Locale) {
  return {
    disclosure: 'details' as const,
    expandedByDefault: false,
    title,
    contextLabel: locale === 'zh-CN' ? '历史公共事件' : 'Historical public event',
    winnerSummary: locale === 'zh-CN' ? `冠军：${champion}` : `Champion: ${champion}`,
  };
}

export function buildBroadcastView(snapshot: BroadcastSnapshot, locale: Locale, now = Date.now()) {
  if (!snapshot.event) {
    return {
      mode: 'chronicle' as const,
      presentation: 'chronicle' as const,
      title: locale === 'zh-CN' ? '灯塔镇镇志' : 'Town Chronicle',
      live: null,
      history: null,
      winnerName: undefined,
    };
  }
  const winnerName = snapshot.participants.find(
    (participant) => participant.residentId === snapshot.event?.winnerId,
  )?.displayName;
  if (snapshot.event.status === 'completed') {
    const champion = winnerName ?? (locale === 'zh-CN' ? '未记录' : 'Not recorded');
    return {
      mode: 'event' as const,
      presentation: 'history' as const,
      title: locale === 'zh-CN' ? '往届赛事记录' : 'Past Event Record',
      live: null,
      history: {
        eventName: snapshot.event.name,
        champion,
        prize: snapshot.event.prize,
        result: winnerName
          ? (locale === 'zh-CN'
            ? `赛事已结束，${winnerName}获得冠军。`
            : `The event has ended. ${winnerName} was the champion.`)
          : (locale === 'zh-CN' ? '赛事已结束，冠军未记录。' : 'The event has ended. No champion was recorded.'),
        logs: [...snapshot.logs].sort((left, right) =>
          left.sequence - right.sequence
            || left.createdAt - right.createdAt
            || left.eventKey.localeCompare(right.eventKey),
        ),
      },
      winnerName,
    };
  }
  const seconds = Math.max(0, Math.ceil((snapshot.event.phaseEndsAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return {
    mode: 'event' as const,
    presentation: 'live' as const,
    title: snapshot.event.name,
    live: {
      phaseLabel: phaseLabels[locale][snapshot.event.phase] ?? snapshot.event.phase,
      countdown: `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`,
      activeCount: snapshot.participants.filter((participant) => participant.active).length,
    },
    history: null,
    winnerName,
  };
}
