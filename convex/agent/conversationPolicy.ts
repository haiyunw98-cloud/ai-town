export type TopicCategory = 'livelihood' | 'relationship' | 'public-life';

export type ConversationTopic = {
  category: TopicCategory;
  detail: string;
};

const TOPIC_TARGETS: Record<TopicCategory, number> = {
  livelihood: 0.6,
  relationship: 0.25,
  'public-life': 0.15,
};

const TOPIC_DETAILS: Record<TopicCategory, readonly string[]> = {
  livelihood: ['work', 'order', 'income', 'shopping', 'meal', 'clothing', 'home', 'rest', 'health'],
  relationship: ['friendship', 'care', 'date', 'misunderstanding', 'cooperation', 'neighbor-help'],
  'public-life': ['market', 'class', 'festival', 'institution', 'local-news', 'safety'],
};

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
  recent: string[],
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
  const allDetails = TOPIC_DETAILS[category];
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
] as const;

const LEGACY_ENGLISH_PATTERNS = [
  /\bocean(?:ic)?[\s/-]+(?:tides?|beacons?|navigation|navigational|waves?|breeze|surface)\b/u,
  /\bsea[\s/-]+(?:beacons?|navigation|navigational|voyage|route|waves?|breeze)\b/u,
  /\bnavigation[\s/-]+at[\s/-]+sea\b/u,
  /\blighthouse[\s/-]+myster(?:y|ies)\b/u,
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

export function filterLegacyMemories<T extends { description: string }>(
  memories: readonly T[],
): T[] {
  return memories.filter((memory) => !containsLegacyStory(memory.description));
}

type ReplyContext = {
  kind: 'start' | 'continue' | 'leave';
  topic: string;
  observerAskedAboutSea: boolean;
};

type ReplyValidation = {
  accepted: boolean;
  text: string;
  reason?: 'world-correction' | 'empty' | 'legacy-story' | 'too-long';
};

const REPLY_LIMITS: Record<ReplyContext['kind'], number> = {
  start: 45,
  continue: 60,
  leave: 35,
};

const EMPTY_FALLBACKS: Record<ReplyContext['kind'], string> = {
  start: '今天过得怎么样？想聊聊镇上的日常吗？',
  continue: '先聊聊今天镇上的日常吧，你最近忙什么？',
  leave: '我先去忙手头的事，回头再聊。',
};

const LEGACY_FALLBACKS: Record<ReplyContext['kind'], string> = {
  start: '先聊聊今天的工作和饭菜吧，你最近怎么样？',
  continue: '我们聊聊今天的工作和邻里日常吧。',
  leave: '我先去忙手头的事，回头再聊。',
};

function sanitizeReply(value: string): string {
  return value
    .replace(/\([^()]*\)|（[^（）]*）/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[\p{P}\s]+/u, '')
    .trim();
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function firstCompleteSentence(value: string): string | undefined {
  return value.match(/^.*?[。！？.!?]/u)?.[0].trim();
}

function trimNaturally(value: string, limit: number): string {
  let characters = Array.from(value.trim()).slice(0, limit);
  let shortened = characters.join('').replace(/[\s,，:：;；、]+$/u, '');
  if (/[。！？.!?]$/u.test(shortened)) {
    return shortened;
  }

  while (unicodeLength(shortened) >= limit) {
    characters = Array.from(shortened);
    characters.pop();
    shortened = characters.join('').replace(/[\s,，:：;；、]+$/u, '');
  }
  return shortened ? `${shortened}。` : '改天再聊。';
}

export function validateResidentReply(raw: string, context: ReplyContext): ReplyValidation {
  if (context.observerAskedAboutSea) {
    return {
      accepted: false,
      text: '镇上没有海，这座塔只是地标。你今天想聊聊镇上的什么？',
      reason: 'world-correction',
    };
  }

  const sanitized = sanitizeReply(raw);
  if (!sanitized) {
    return { accepted: false, text: EMPTY_FALLBACKS[context.kind], reason: 'empty' };
  }
  if (containsLegacyStory(sanitized)) {
    return {
      accepted: false,
      text: LEGACY_FALLBACKS[context.kind],
      reason: 'legacy-story',
    };
  }

  const limit = REPLY_LIMITS[context.kind];
  if (unicodeLength(sanitized) <= limit) {
    return { accepted: true, text: sanitized };
  }

  const sentence = firstCompleteSentence(sanitized) ?? sanitized;
  return {
    accepted: false,
    text: unicodeLength(sentence) <= limit ? sentence : trimNaturally(sentence, limit),
    reason: 'too-long',
  };
}
