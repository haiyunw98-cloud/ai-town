import type { Locale } from '../i18n';
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

const sameLocalDay = (timestamp: number, now: number) => {
  const left = new Date(timestamp);
  const right = new Date(now);
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
};

const cleanMarkdown = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

type LifeEvent = NonNullable<BroadcastSnapshot['dailyLifeEvents']>[number];
type DailyMessage = BroadcastSnapshot['dailyMessages'][number];
type Conversation = BroadcastSnapshot['conversations'][number];
type EventLog = BroadcastSnapshot['logs'][number];

type DailyReportData = {
  snapshot: BroadcastSnapshot;
  locale: Locale;
  now: number;
  lifeEvents: LifeEvent[];
  dailyMessages: DailyMessage[];
  conversations: Conversation[];
  logs: EventLog[];
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
  }).format(timestamp);
}

function formatReportTime(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(timestamp);
}

function buildMetadataSection(data: DailyReportData) {
  return reportSection('日报元数据', [
    `- 日期：${formatReportDate(data.now, data.locale)}`,
    `- 生成时间：${formatReportTime(data.now, data.locale)}`,
    `- 本地日期筛选：${formatReportDate(data.now, data.locale)}`,
  ]);
}

function buildOverviewSection(data: DailyReportData) {
  return reportSection('全镇事实概览', [
    `- 居民档案：${residentLifeProfiles.length} 人`,
    `- 当前状态记录：${data.snapshot.residentActivity.length} 条`,
    `- 当日生活记录：${data.lifeEvents.length} 条`,
    `- 当日对话：${data.conversations.length} 组`,
    `- 当日原始消息：${data.dailyMessages.length} 条`,
    `- 当日公共事件日志：${data.logs.length} 条`,
  ]);
}

function resolveResidentProfile(residentId: string, displayName: string) {
  return residentLifeProfiles.find((profile) => profile.id === residentId)
    ?? residentLifeProfiles.find((profile) => profile.name === displayName);
}

function matchesResidentProfile(profileId: string, residentId: string, displayName: string) {
  return resolveResidentProfile(residentId, displayName)?.id === profileId;
}

function residentIdentity(residentId: string, displayName: string) {
  const resolvedName = resolveResidentProfile(residentId, displayName)?.name ?? displayName;
  return residentId ? `[${cleanMarkdown(residentId)}] ${cleanMarkdown(resolvedName)}` : cleanMarkdown(resolvedName);
}

function buildResidentSection(data: DailyReportData) {
  const lines: string[] = [];
  for (const profile of residentLifeProfiles) {
    const activity = data.snapshot.residentActivity.find((entry) =>
      matchesResidentProfile(profile.id, entry.residentId, entry.displayName),
    );
    const events = data.lifeEvents.filter((entry) =>
      matchesResidentProfile(profile.id, entry.residentId, entry.displayName),
    );
    lines.push(`### ${profile.name}｜${profile.occupation}`);
    lines.push('');
    lines.push(`- 居民 ID：${profile.id}`);
    lines.push(activity
      ? `- 当前状态：${cleanMarkdown(activity.status)}；${cleanMarkdown(activity.detail)}`
      : '- 当前状态：当日无记录');
    lines.push('- 当日活动：');
    if (events.length === 0) {
      lines.push('  - 当日无记录');
    } else {
      for (const event of events) {
        lines.push(`  - ${residentIdentity(event.residentId, event.displayName)}｜${cleanMarkdown(event.text)}`);
      }
    }
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
        `- ${profile.name} → ${target?.name ?? relationship.targetId}｜${relationship.label}｜${relationship.kind}｜${relationship.score}/100｜${cleanMarkdown(relationship.summary)}`,
      );
    }
  }
  lines.push('', '### 当日实际互动', '');
  if (data.conversations.length === 0) {
    lines.push('- 当日无记录');
  } else {
    for (const conversation of data.conversations) {
      const rawMessages = data.dailyMessages.filter(
        (message) => message.conversationId === conversation.conversationId,
      );
      const fallbackMessages = conversation.messages.filter((message) =>
        sameLocalDay(message.createdAt, data.now),
      );
      const messageCount = rawMessages.length > 0 ? rawMessages.length : fallbackMessages.length;
      lines.push(`- ${conversation.participantNames.map(cleanMarkdown).join(' × ')}｜消息 ${messageCount} 条`);
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
    lines.push(`### ${landmark.name}`);
    lines.push('');
    lines.push(`- 说明：${cleanMarkdown(landmark.description)}`);
    lines.push(`- 开放时间：${landmark.openHours}`);
    lines.push(`- 服务：${landmark.services.join('、')}`);
    lines.push('- 当日确认使用：');
    if (confirmedUses.length === 0) {
      lines.push('  - 当日无记录');
    } else {
      for (const event of confirmedUses) {
        lines.push(`  - ${residentIdentity(event.residentId, event.displayName)}｜${cleanMarkdown(event.text)}`);
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
      lines.push(`- ${residentIdentity(event.residentId, event.displayName)}｜${cleanMarkdown(event.text)}`);
    }
    lines.push('');
  }
  return reportSection('活动分类', lines);
}

function conversationExcerptMessages(conversation: Conversation, data: DailyReportData) {
  const rawMessages = data.dailyMessages.filter(
    (message) => message.conversationId === conversation.conversationId,
  );
  if (rawMessages.length > 0) return rawMessages.slice(-4);
  return conversation.messages
    .filter((message) => sameLocalDay(message.createdAt, data.now))
    .sort(chronological)
    .slice(-4);
}

function conversationExcerptAuthor(message: DailyMessage | Conversation['messages'][number]) {
  return 'authorId' in message
    ? residentIdentity(message.authorId, message.authorName)
    : cleanMarkdown(message.authorName);
}

function buildConversationsSection(data: DailyReportData) {
  const lines: string[] = [];
  for (const conversation of data.conversations) {
    lines.push(`### ${conversation.participantNames.map(cleanMarkdown).join(' × ')}`, '');
    lines.push(`- 摘要：${cleanMarkdown(conversation.summary)}`);
    const excerpts = conversationExcerptMessages(conversation, data).map(
      (message) => `${conversationExcerptAuthor(message)}：“${cleanMarkdown(message.text).slice(0, 100)}”`,
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
    lines.push(`- 赛事：${cleanMarkdown(event.name)}`);
    lines.push(`- 状态：${cleanMarkdown(event.status)}`);
    lines.push(`- 阶段：${cleanMarkdown(event.phase)}`);
    if (event.winnerId) lines.push(`- 冠军：${winner?.displayName ?? event.winnerId}`);
    lines.push(`- 奖励：${cleanMarkdown(event.prize)}`);
  }
  if (data.logs.length > 0) {
    lines.push('', '### 当日日志', '');
    for (const log of data.logs) {
      lines.push(`- [${log.eventKey}#${log.sequence}] ${cleanMarkdown(log.text)}`);
    }
  }
  return reportSection('赛事与公共事件', lines);
}

function buildLifeAppendixSection(data: DailyReportData) {
  return reportSection('生活记录附录', data.lifeEvents.map((event) =>
    `- ${event.createdAt}｜${residentIdentity(event.residentId, event.displayName)}｜${activityKindLabels[event.kind] ?? '其他'}｜${cleanMarkdown(event.text)}`,
  ));
}

function buildRawMessagesSection(data: DailyReportData) {
  return reportSection('原始对话附录', data.dailyMessages.map((message) => {
    const observerLabel = message.observerIntervention ? '｜观察者介入' : '';
    return `- ${message.createdAt}｜${residentIdentity(message.authorId, message.authorName)}${observerLabel}｜${cleanMarkdown(message.text)}`;
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
    conversations: snapshot.conversations
      .filter((conversation) => sameLocalDay(conversation.updatedAt, now))
      .sort((left, right) => left.updatedAt - right.updatedAt),
    logs: snapshot.logs
      .filter((entry) => sameLocalDay(entry.createdAt, now))
      .sort(chronological),
  };
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
  const combined = conversations.map((conversation) => conversation.summary).join('');
  const hasMystery = /异常|枯萎|挪动|水位|机关|雾|失踪|追查/.test(combined);
  return {
    headline: hasMystery ? '小镇异变：河道、灯火与花木的线索正在交汇' : '今日灯塔镇：居民们各自生活，也悄悄影响着彼此',
    bullets: conversations.slice(0, 4).map(
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

export function buildBroadcastView(snapshot: BroadcastSnapshot, locale: Locale, now = Date.now()) {
  if (!snapshot.event) {
    return {
      mode: 'chronicle' as const,
      title: locale === 'zh-CN' ? '灯塔镇镇志' : 'Town Chronicle',
      phaseLabel: '',
      countdown: '--:--',
      activeCount: 0,
      winnerName: undefined,
    };
  }
  const seconds = Math.max(0, Math.ceil((snapshot.event.phaseEndsAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return {
    mode: 'event' as const,
    title: snapshot.event.name,
    phaseLabel: phaseLabels[locale][snapshot.event.phase] ?? snapshot.event.phase,
    countdown: `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`,
    activeCount: snapshot.participants.filter((participant) => participant.active).length,
    winnerName: snapshot.participants.find(
      (participant) => participant.residentId === snapshot.event?.winnerId,
    )?.displayName,
  };
}
