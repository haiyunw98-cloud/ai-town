import type { Locale } from '../i18n';
import { residentLifeProfiles } from '../../data/worlds/lighthouse-town/lives';

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

export function buildDailyReport(
  snapshot: BroadcastSnapshot,
  locale: Locale,
  now = Date.now(),
) {
  const date = new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
  }).format(now);
  const story = buildTownStory(snapshot.conversations);
  const lifeEvents = (snapshot.dailyLifeEvents ?? []).filter((event) =>
    sameLocalDay(event.createdAt, now),
  );
  const conversations = snapshot.conversations.filter((conversation) =>
    sameLocalDay(conversation.updatedAt, now),
  );
  const lines = [
    '# 灯塔镇观察者日报',
    '',
    `- 日期：${date}`,
    `- 生成时间：${new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)}`,
    `- 活跃居民：${snapshot.residentActivity.length} 人`,
    `- 今日生活记录：${lifeEvents.length} 条`,
    `- 今日重要对话：${conversations.length} 组`,
    '',
    '## 全镇摘要',
    '',
    story.headline,
    ...story.bullets.map((bullet) => `- ${cleanMarkdown(bullet)}`),
    '',
    '## 居民活动与发展',
    '',
  ];

  for (const resident of snapshot.residentActivity) {
    const profile = residentLifeProfiles.find((entry) => entry.name === resident.displayName);
    const events = lifeEvents.filter((event) => event.residentId === resident.residentId).slice(0, 8);
    lines.push(`### ${resident.displayName}${profile ? `｜${profile.occupation}` : ''}`);
    lines.push('');
    lines.push(`- 当前情况：${resident.status}；${cleanMarkdown(resident.detail)}`);
    if (profile) {
      lines.push(`- 当前目标：${profile.currentGoal}`);
      lines.push(`- 生计发展：${profile.business}`);
      const relationships = profile.relationships.map((relationship) => {
        const target = residentLifeProfiles.find((entry) => entry.id === relationship.targetId);
        return `${target?.name ?? relationship.targetId}（${relationship.label} ${relationship.score}/100）`;
      });
      lines.push(`- 关系进展：${relationships.join('；') || '暂无明确关系记录'}`);
    }
    lines.push(`- 今日行动：${events.length > 0 ? events.map((event) => cleanMarkdown(event.text)).join('；') : '继续当前生活节奏，暂无新增记录'}`);
    lines.push('');
  }

  lines.push('## 重要对话', '');
  if (conversations.length === 0) {
    lines.push('- 今日暂未形成可归纳的对话。');
  } else {
    for (const conversation of conversations) {
      lines.push(`### ${conversation.participantNames.join(' × ')}`);
      lines.push('');
      lines.push(`- 摘要：${cleanMarkdown(conversation.summary)}`);
      const originalMessages = snapshot.dailyMessages.filter(
        (message) => message.conversationId === conversation.conversationId
          && sameLocalDay(message.createdAt, now),
      );
      const excerpts = (originalMessages.length > 0 ? originalMessages : conversation.messages).map(
        (message) => `${message.authorName}：“${cleanMarkdown(message.text).slice(0, 100)}”`,
      );
      if (excerpts.length > 0) lines.push(`- 对话摘录：${excerpts.join('；')}`);
      lines.push('');
    }
  }

  lines.push('## 公共事件与镇志', '');
  if (snapshot.event) {
    const winner = snapshot.participants.find(
      (participant) => participant.residentId === snapshot.event?.winnerId,
    );
    lines.push(`- ${snapshot.event.name}：${snapshot.event.status === 'completed' ? `已结束${winner ? `，冠军为 ${winner.displayName}` : ''}` : '进行中'}`);
    lines.push(`- 奖励：${snapshot.event.prize}`);
  }
  const logs = snapshot.logs.filter((entry) => sameLocalDay(entry.createdAt, now)).slice(0, 20);
  if (logs.length === 0) lines.push('- 今日暂无新增公共事件。');
  else logs.forEach((entry) => lines.push(`- ${cleanMarkdown(entry.text)}`));
  lines.push('', '---', '由灯塔镇观察台根据本地生活记录自动生成。');
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
