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

export type ConversationTopic = {
  category: TopicCategory;
  detail: TopicDetail;
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

export function filterLegacyMemories<T extends { description: string }>(
  memories: readonly T[],
): T[] {
  return memories.filter((memory) => !containsLegacyStory(memory.description));
}

export type ReplyContext = {
  kind: 'start' | 'continue' | 'leave';
  topic: TopicDetail;
  observerAskedAboutSea: boolean;
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

const TOPIC_LABELS: Record<TopicDetail, string> = {
  work: '手头工作',
  order: '订单进展',
  income: '收入安排',
  shopping: '采买计划',
  meal: '今日饭菜',
  clothing: '衣物添置',
  home: '居家琐事',
  rest: '休息安排',
  health: '身体近况',
  friendship: '朋友近况',
  care: '彼此照应',
  date: '约会安排',
  misunderstanding: '误会化解',
  cooperation: '合作进展',
  'neighbor-help': '邻里帮忙',
  market: '集市见闻',
  class: '课堂学习',
  festival: '节庆准备',
  institution: '镇上机构',
  'local-news': '镇上消息',
  safety: '日常安全',
};

function topicFallback(
  topic: TopicDetail,
  kind: ReplyContext['kind'],
  reason: 'empty' | 'legacy-story',
): string {
  const label = TOPIC_LABELS[topic];
  if (reason === 'empty') {
    if (kind === 'start') return `今天想聊聊${label}，你最近怎么样？`;
    if (kind === 'continue') return `说说${label}吧，你最近有什么新鲜事？`;
    return `关于${label}，我们改天再聊。`;
  }
  if (kind === 'start') return `先不说传闻了，聊聊${label}吧。`;
  if (kind === 'continue') return `不说那些传闻了，我们聊聊${label}吧。`;
  return `先不聊传闻，${label}改天再说。`;
}

const OPEN_PARENTHESIS = new Set(['(', '（']);
const CLOSE_PARENTHESIS = new Set([')', '）']);
const FRAGMENT_PUNCTUATION = /[。！？.!?，,：:；;、]/u;
const QUOTE_CHARACTER = /["'“”‘’]/u;
const SENTENCE_END = /[。！？.!?]/u;
const SUBSTANTIVE_CHARACTER = /[\p{Letter}\p{Number}\p{Symbol}]/u;

function removeStageDirections(value: string): string {
  const result: string[] = [];
  let depth = 0;
  let hadSubstantiveBeforeDirection = false;
  let hasSubstantiveInSentence = false;
  let discardDirectionFragment = false;

  for (const character of value) {
    if (OPEN_PARENTHESIS.has(character)) {
      if (depth === 0) hadSubstantiveBeforeDirection = hasSubstantiveInSentence;
      depth += 1;
      continue;
    }
    if (CLOSE_PARENTHESIS.has(character)) {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && !hadSubstantiveBeforeDirection) discardDirectionFragment = true;
      }
      continue;
    }
    if (depth > 0) continue;

    if (discardDirectionFragment) {
      if (/\s/u.test(character) || FRAGMENT_PUNCTUATION.test(character)) continue;
      if (QUOTE_CHARACTER.test(character)) {
        result.push(character);
        continue;
      }
      discardDirectionFragment = false;
    }

    result.push(character);
    if (SENTENCE_END.test(character)) {
      hasSubstantiveInSentence = false;
    } else if (SUBSTANTIVE_CHARACTER.test(character)) {
      hasSubstantiveInSentence = true;
    }
  }
  return result.join('');
}

function sanitizeReply(value: string): string {
  return removeStageDirections(value).replace(/\s+/gu, ' ').trim();
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

type GraphemeSegmenter = { segment(value: string): Iterable<{ segment: string }> };

type GraphemeSegmenterConstructor = new (
  locale?: string | string[],
  options?: { granularity: 'grapheme' },
) => GraphemeSegmenter;

const GraphemeSegmenter = (
  Intl as unknown as {
    Segmenter?: GraphemeSegmenterConstructor;
  }
).Segmenter;
const replyGraphemeSegmenter = GraphemeSegmenter
  ? new GraphemeSegmenter('zh-CN', { granularity: 'grapheme' })
  : null;

function extendsFallbackGrapheme(value: string): boolean {
  const codePoint = value.codePointAt(0) ?? 0;
  return (
    /\p{Mark}/u.test(value) ||
    codePoint === 0xfe0e ||
    codePoint === 0xfe0f ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
  );
}

function fallbackGraphemes(value: string): string[] {
  const clusters: string[] = [];
  let joinNext = false;
  for (const codePoint of value) {
    if (clusters.length === 0) {
      clusters.push(codePoint);
      continue;
    }
    const lastIndex = clusters.length - 1;
    if (codePoint === '\u200d') {
      clusters[lastIndex] += codePoint;
      joinNext = true;
    } else if (joinNext || extendsFallbackGrapheme(codePoint)) {
      clusters[lastIndex] += codePoint;
      joinNext = false;
    } else {
      clusters.push(codePoint);
    }
  }
  return clusters;
}

function replyGraphemes(value: string): string[] {
  if (!replyGraphemeSegmenter) return fallbackGraphemes(value);
  return Array.from(replyGraphemeSegmenter.segment(value), ({ segment }) => segment);
}

const SHORT_ABBREVIATIONS = new Set([
  'dr',
  'mr',
  'mrs',
  'ms',
  'prof',
  'sr',
  'jr',
  'st',
  'no',
  'vs',
  'etc',
]);

function isSentencePeriod(characters: string[], index: number): boolean {
  const previous = characters[index - 1] ?? '';
  const next = characters[index + 1] ?? '';
  if (/\d/u.test(previous) && /\d/u.test(next)) return false;
  if (/[A-Za-z]/u.test(previous) && /[A-Za-z]/u.test(next)) return false;

  const remainder = characters.slice(index + 1).join('');
  if (!/\S/u.test(remainder)) return true;
  const prefix = characters.slice(0, index).join('');
  const word = prefix.match(/([A-Za-z]+)$/u)?.[1].toLocaleLowerCase('en-US');
  if (word && SHORT_ABBREVIATIONS.has(word)) return false;
  if (/(?:\b[A-Za-z]\.)+[A-Za-z]$/u.test(prefix)) return false;
  return true;
}

function firstCompleteSentence(value: string): string | undefined {
  const characters = Array.from(value);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (!SENTENCE_END.test(character)) continue;
    if (character === '.' && !isSentencePeriod(characters, index)) continue;

    let end = index + 1;
    while (end < characters.length && /["'”’]/u.test(characters[end])) end += 1;
    return characters.slice(0, end).join('').trim();
  }
  return undefined;
}

function trimNaturally(value: string, limit: number): string {
  const contentLimit = Math.max(0, limit - 1);
  let used = 0;
  let shortened = '';
  for (const grapheme of replyGraphemes(value.trim())) {
    const graphemeLength = unicodeLength(grapheme);
    if (used + graphemeLength > contentLimit) break;
    shortened += grapheme;
    used += graphemeLength;
  }
  shortened = shortened.replace(/[\s,，:：;；、]+$/u, '');
  if (/[。！？.!?]$/u.test(shortened)) {
    return shortened;
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
    return {
      accepted: false,
      text: topicFallback(context.topic, context.kind, 'empty'),
      reason: 'empty',
    };
  }
  if (containsLegacyStory(sanitized)) {
    return {
      accepted: false,
      text: topicFallback(context.topic, context.kind, 'legacy-story'),
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
