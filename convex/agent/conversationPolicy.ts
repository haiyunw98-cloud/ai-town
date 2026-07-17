import type { WorldLocale } from '../../data/worlds/lighthouse-town/manifest';
import {
  hasMeaningfulConversationText,
  isConversationSentencePeriod,
  sanitizeConversationText,
  segmentConversationGraphemes,
} from '../util/conversationText';

export {
  sanitizeConversationText,
  segmentConversationGraphemes,
  splitConversationClauses,
} from '../util/conversationText';

export type TopicCategory = 'livelihood' | 'relationship' | 'public-life';

const TOPIC_TARGETS: Record<TopicCategory, number> = {
  livelihood: 0.6,
  relationship: 0.25,
  'public-life': 0.15,
};

export const TOPIC_DETAILS = {
  livelihood: ['work', 'order', 'income', 'shopping', 'meal', 'clothing', 'home', 'rest', 'health'],
  relationship: ['friendship', 'care', 'date', 'misunderstanding', 'cooperation', 'neighbor-help'],
  'public-life': ['market', 'class', 'festival', 'institution', 'local-news', 'safety'],
} as const satisfies Record<TopicCategory, readonly string[]>;

export type TopicDetail = (typeof TOPIC_DETAILS)[TopicCategory][number];

const TOPIC_DETAIL_SET = new Set<string>(Object.values(TOPIC_DETAILS).flat());

export function isTopicDetail(value: unknown): value is TopicDetail {
  return typeof value === 'string' && TOPIC_DETAIL_SET.has(value);
}

export type ConversationTopic = {
  category: TopicCategory;
  detail: TopicDetail;
};

export type TopicSelectionRow = {
  category: TopicCategory;
  detail: string;
};

export function deriveTopicSelectionInput(
  currentDayRows: readonly TopicSelectionRow[],
  recentRows: readonly TopicSelectionRow[],
): { counts: Record<TopicCategory, number>; recent: string[] } {
  const counts: Record<TopicCategory, number> = {
    livelihood: 0,
    relationship: 0,
    'public-life': 0,
  };
  for (const topic of currentDayRows) counts[topic.category] += 1;
  return {
    counts,
    recent: recentRows.slice(0, 3).map((topic) => topic.detail),
  };
}

export const CONVERSATION_TOPIC_LABELS: Record<WorldLocale, Record<TopicDetail, string>> = {
  'zh-CN': {
    work: '工作',
    order: '订单',
    income: '收入',
    shopping: '采购',
    meal: '饮食',
    clothing: '衣物',
    home: '家务',
    rest: '休息',
    health: '健康',
    friendship: '友情',
    care: '照护',
    date: '约会',
    misunderstanding: '误会',
    cooperation: '合作',
    'neighbor-help': '邻里互助',
    market: '集市',
    class: '课程',
    festival: '节庆',
    institution: '机构服务',
    'local-news': '地方消息',
    safety: '公共安全',
  },
  en: {
    work: 'Work',
    order: 'Orders',
    income: 'Income',
    shopping: 'Shopping',
    meal: 'Food',
    clothing: 'Clothing',
    home: 'Housework',
    rest: 'Rest',
    health: 'Health',
    friendship: 'Friendship',
    care: 'Care',
    date: 'Dating',
    misunderstanding: 'Misunderstandings',
    cooperation: 'Cooperation',
    'neighbor-help': 'Neighborly help',
    market: 'Market',
    class: 'Classes',
    festival: 'Festivals',
    institution: 'Public services',
    'local-news': 'Local news',
    safety: 'Public safety',
  },
};

function conversationTopicLabel(detail: string, locale: WorldLocale): string {
  const labels = CONVERSATION_TOPIC_LABELS[locale];
  return Object.prototype.hasOwnProperty.call(labels, detail)
    ? labels[detail as TopicDetail]
    : locale === 'en'
      ? 'Daily life'
      : '日常近况';
}

export function conversationPromptRules(topic: { detail: string }, locale: WorldLocale): string[] {
  const label = conversationTopicLabel(topic.detail, locale);
  if (locale === 'en') {
    return [
      `Daily-life topic for this conversation: ${label}.`,
      'Speak in natural English and advance only one idea per turn.',
      'Keep ordinary replies to 10–30 words; openings to 8–24 words; farewells to 6–18 words.',
      'Do not use parenthetical stage directions or lengthy descriptions of actions, surroundings, or inner thoughts.',
      'Do not initiate anomalies, mysteries, investigations, tower mechanisms, or ocean topics.',
    ];
  }
  return [
    `本轮日常话题：${label}。`,
    '用自然的简体中文交谈，每轮只推进一个意思。',
    '普通回复控制在 20–60 个中文字符；开场 15–45 字；告别 10–35 字。',
    '不要使用括号舞台说明，不要长篇描写动作、环境或内心。',
    '不要发起异变、谜团、调查、灯塔机关或海洋话题。',
  ];
}

export function observerSeaCorrectionInstruction(locale: WorldLocale): string {
  if (locale === 'en') {
    return 'The observer asked about the ocean setting. First say “There is no sea in town; this tower is only a landmark.” Then respond with one short question.';
  }
  return '观察者问到了海洋设定。先说“镇上没有海，这座塔只是地标。”，再用一句短问句回应。';
}

const TOPIC_CATEGORIES = Object.keys(TOPIC_TARGETS) as TopicCategory[];

function deterministicHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function selectConversationTopic(
  seed: string,
  recent: readonly string[],
  counts: Record<TopicCategory, number>,
): ConversationTopic {
  const nextTotal = TOPIC_CATEGORIES.reduce((total, category) => total + counts[category], 0) + 1;
  const deficits = TOPIC_CATEGORIES.map((category) => ({
    category,
    deficit: TOPIC_TARGETS[category] * nextTotal - counts[category],
  }));
  const greatestDeficit = Math.max(...deficits.map(({ deficit }) => deficit));
  const tiedCategories = deficits
    .filter(({ deficit }) => Math.abs(deficit - greatestDeficit) < Number.EPSILON * nextTotal)
    .map(({ category }) => category);
  const category =
    tiedCategories[deterministicHash(`${seed}:category:${nextTotal}`) % tiedCategories.length];

  const recentDetails = new Set(recent.slice(-3));
  const allDetails: readonly TopicDetail[] = TOPIC_DETAILS[category];
  const availableDetails = allDetails.filter((detail) => !recentDetails.has(detail));
  const candidates = availableDetails.length > 0 ? availableDetails : allDetails;
  const detail = candidates[deterministicHash(`${seed}:detail:${category}`) % candidates.length];

  return { category, detail };
}

const LEGACY_CHINESE_TERMS = [
  '海面',
  '海潮',
  '潮汐',
  '观潮',
  '航标',
  '海风',
  '海浪',
  '夜航',
  '失落航路',
  '无海航路',
  '异常闪光',
  '灯塔谜',
  '机关谜',
  '线索交汇',
  '雾潮',
  '灯塔导航',
] as const;

const LEGACY_ENGLISH_PATTERNS = [
  /\bocean(?:ic)?[\s/-]+(?:tides?|beacons?|navigation|navigational|waves?|breeze|surface)\b/u,
  /\bsea[\s/-]+(?:beacons?|navigation|navigational|voyage|route|waves?|breeze)\b/u,
  /\bnavigation[\s/-]+at[\s/-]+sea\b/u,
  /\blighthouse[\s/-]+(?:myster(?:y|ies)|navigation|navigational)\b/u,
  /\banomal(?:y|ies|ous)\b/u,
  /\blost[\s/-]+(?:sea[\s/-]+)?route\b/u,
  /\bnight[\s/-]+sailing\b/u,
  /\bfog[\s/-]+tide\b/u,
] as const;

export function containsLegacyStory(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US');
  return (
    LEGACY_CHINESE_TERMS.some((term) => normalized.includes(term)) ||
    LEGACY_ENGLISH_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

const ARCHIVED_EVENT_PATTERNS = [
  /(?:百万金贝|一百万金贝)/u,
  /寻宝(?:赛|比赛|竞赛)/u,
  /\bmillion[\s-]+(?:gold(?:en)?[\s-]+)?shells?\b/iu,
  /\btreasure[\s-]+(?:hunt|contest)\b/iu,
  /\b(?:lighthouse[\s-]+town[\s-]+)?million[\s-]+gold(?:en)?[\s-]+shell(?:s)?[\s-]+treasure[\s-]+hunt(?:[\s-]+(?:race|competition))?\b/iu,
] as const;

/** Public archive content that must not become an agent's autonomous personal memory. */
export function containsArchivedEventMemory(value: string): boolean {
  const normalized = value.normalize('NFKC');
  return ARCHIVED_EVENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

const AUTONOMOUS_MEMORY_FORBIDDEN_PATTERNS = [
  /海洋/u,
  /灯塔谜团/u,
  /异变/u,
  /心理诊断/u,
  /未说出口的感情/u,
  /\boceans?\b/iu,
  /\blighthouse[\s-]+myster(?:y|ies)\b/iu,
  /\banomal(?:y|ies|ous)\b/iu,
  /\bpsychological[\s-]+diagnos(?:is|es|tic)\b/iu,
  /\bunspoken[\s-]+feelings?\b/iu,
] as const;

export function containsForbiddenAutonomousMemory(value: string): boolean {
  const normalized = value.normalize('NFKC');
  return (
    containsLegacyStory(normalized) ||
    containsArchivedEventMemory(normalized) ||
    AUTONOMOUS_MEMORY_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

export function filterLegacyMemories<T extends { description: string }>(
  memories: readonly T[],
): T[] {
  return memories.filter((memory) => !containsForbiddenAutonomousMemory(memory.description));
}

export type ReplyContext = {
  kind: 'start' | 'continue' | 'leave';
  topic: TopicDetail;
  observerAskedAboutSea: boolean;
  locale?: WorldLocale;
};

export type ReplyRejectionReason = 'world-correction' | 'empty' | 'legacy-story' | 'too-long';

export type ReplyValidation =
  | { accepted: true; text: string; reason?: never }
  | { accepted: false; text: string; reason: ReplyRejectionReason };

const REPLY_LIMITS: Record<ReplyContext['kind'], number> = {
  start: 45,
  continue: 60,
  leave: 35,
};

function topicFallback(
  topic: TopicDetail,
  kind: ReplyContext['kind'],
  reason: 'empty' | 'legacy-story',
  locale: WorldLocale,
): string {
  const label = CONVERSATION_TOPIC_LABELS[locale][topic];
  if (locale === 'en') {
    if (reason === 'empty') {
      if (kind === 'start') return `Let's discuss ${label}. How are you?`;
      if (kind === 'continue') return `Let's talk about ${label}. What's new with you?`;
      return `More ${label} another day.`;
    }
    if (kind === 'start') return `Skip rumors; let's discuss ${label}.`;
    if (kind === 'continue') return `Let's skip rumors and discuss ${label}.`;
    return `No rumors; ${label} later.`;
  }
  if (reason === 'empty') {
    if (kind === 'start') return `今天想聊聊${label}，你最近怎么样？`;
    if (kind === 'continue') return `说说${label}吧，你最近有什么新鲜事？`;
    return `关于${label}，我们改天再聊。`;
  }
  if (kind === 'start') return `先不说传闻了，聊聊${label}吧。`;
  if (kind === 'continue') return `不说那些传闻了，我们聊聊${label}吧。`;
  return `先不聊传闻，${label}改天再说。`;
}

const SENTENCE_END = /[。！？.!?]/u;

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

const MATCHING_OUTER_QUOTES: Record<string, string> = {
  '“': '”',
  '‘': '’',
  '"': '"',
  "'": "'",
};

function stripMatchingOuterQuotes(value: string): string {
  const characters = Array.from(value.trim());
  const opening = characters[0];
  if (!opening || MATCHING_OUTER_QUOTES[opening] !== characters[characters.length - 1]) {
    return value;
  }
  return characters.slice(1, -1).join('').trim();
}

function firstCompleteSentence(value: string): string | undefined {
  const characters = Array.from(value);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (!SENTENCE_END.test(character)) continue;
    if (character === '.' && !isConversationSentencePeriod(characters, index)) continue;

    let end = index + 1;
    while (end < characters.length && /["'”’]/u.test(characters[end])) end += 1;
    return characters.slice(0, end).join('').trim();
  }
  return undefined;
}

function trimNaturally(value: string, limit: number, locale: WorldLocale): string {
  const contentLimit = Math.max(0, limit - 1);
  let used = 0;
  let shortened = '';
  for (const grapheme of segmentConversationGraphemes(value.trim())) {
    const graphemeLength = unicodeLength(grapheme);
    if (used + graphemeLength > contentLimit) break;
    shortened += grapheme;
    used += graphemeLength;
  }
  shortened = shortened.replace(/[\s,，:：;；、]+$/u, '');
  if (/[。！？.!?]$/u.test(shortened)) {
    return shortened;
  }
  if (shortened) return `${shortened}${locale === 'en' ? '.' : '。'}`;
  return locale === 'en' ? "Let's talk another day." : '改天再聊。';
}

export function validateResidentReply(raw: string, context: ReplyContext): ReplyValidation {
  const locale = context.locale ?? 'zh-CN';
  if (context.observerAskedAboutSea) {
    return {
      accepted: false,
      text:
        locale === 'en'
          ? 'There is no sea here; the tower is a landmark. What now?'
          : '镇上没有海，这座塔只是地标。你今天想聊聊镇上的什么？',
      reason: 'world-correction',
    };
  }

  const sanitized = sanitizeConversationText(raw);
  if (!sanitized || !hasMeaningfulConversationText(sanitized)) {
    return {
      accepted: false,
      text: topicFallback(context.topic, context.kind, 'empty', locale),
      reason: 'empty',
    };
  }
  if (containsForbiddenAutonomousMemory(sanitized)) {
    return {
      accepted: false,
      text: topicFallback(context.topic, context.kind, 'legacy-story', locale),
      reason: 'legacy-story',
    };
  }

  const limit = REPLY_LIMITS[context.kind];
  if (unicodeLength(sanitized) <= limit) {
    return { accepted: true, text: sanitized };
  }

  const truncationSource = stripMatchingOuterQuotes(sanitized);
  const sentence = firstCompleteSentence(truncationSource) ?? truncationSource;
  return {
    accepted: false,
    text: unicodeLength(sentence) <= limit ? sentence : trimNaturally(sentence, limit, locale),
    reason: 'too-long',
  };
}
