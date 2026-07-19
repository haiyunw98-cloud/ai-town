import { sanitizeConversationText, splitConversationClauses } from './conversationText';

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
  '河道线索',
  '花木线索',
  '机关线索',
  '灯塔线索',
  '灯火装置',
] as const;

const LEGACY_ENGLISH_PATTERNS = [
  /\bocean(?:ic)?[\s/-]+(?:tides?|beacons?|navigation|navigational|waves?|breeze|surface)\b/u,
  /\bsea[\s/-]+(?:beacons?|navigation|navigational|voyage|route|waves?|breeze)\b/u,
  /\bnavigation[\s/-]+at[\s/-]+sea\b/u,
  /\blighthouse[\s/-]+(?:myster(?:y|ies)|navigation|navigational)\b/u,
  /\b(?:lighthouse|town)\b[^.!?]{0,40}\banomal(?:y|ies|ous)\b/u,
  /\banomal(?:y|ies|ous)\b[^.!?]{0,40}\b(?:lighthouse|town)\b/u,
  /\banomal(?:y|ies|ous)[\s/-]+story\b/u,
  /^\s*(?:an?\s+)?anomal(?:y|ies|ous)(?:\s+story)?[.!?]?\s*$/u,
  /\blost[\s/-]+(?:sea[\s/-]+)?route\b/u,
  /\bnight[\s/-]+sailing\b/u,
  /\bfog[\s/-]+tide\b/u,
] as const;

const LEGACY_CHINESE_CONTEXT_PATTERNS = [
  /(?:灯塔|机关)[^。！？]{0,12}(?:谜团|谜题|之谜|谜)/u,
  /灯塔[^。！？]{0,16}(?:每隔)?十三夜/u,
  /(?:小镇|灯塔)[^。！？]{0,20}异变/u,
  /异变[^。！？]{0,20}(?:小镇|灯塔)/u,
] as const;

const ARCHIVED_EVENT_PATTERNS = [
  /(?:百万金贝|一百万金贝)/u,
  /(?:往届|上一届|旧(?:的)?|历史|已结束|已经结束|结束的|已完成|已经完成|完成的)[^。！？]{0,30}寻宝(?:赛|比赛|竞赛)/u,
  /寻宝(?:赛|比赛|竞赛)[^。！？]{0,30}(?:往届|上一届|旧(?:的)?|历史|已结束|已经结束|结束|已完成|已经完成|完成)/u,
  /\bmillion[\s-]+(?:gold(?:en)?[\s-]+)?shells?\b/iu,
  /\b(?:previous|prior|past|archived|completed|finished|ended)\b[^.!?]{0,40}\btreasure[\s-]+(?:hunt|contest)\b/iu,
  /\btreasure[\s-]+(?:hunt|contest)\b[^.!?]{0,40}\b(?:previous|prior|past|archived|completed|finished|ended)\b/iu,
  /\b(?:lighthouse[\s-]+town[\s-]+)?million[\s-]+gold(?:en)?[\s-]+shell(?:s)?[\s-]+treasure[\s-]+hunt(?:[\s-]+(?:race|competition))?\b/iu,
] as const;

const AUTONOMOUS_MEMORY_FORBIDDEN_PATTERNS = [
  /海洋/u,
  /灯塔谜团/u,
  /草木(?:焦躁|躁动|异动)/u,
  /(?:浓雾|雾气)[^。！？]{0,20}(?:草木|花木)[^。！？]{0,8}(?:生长|疯长|异动|躁动|焦躁)/u,
  /花木生长/u,
  /心理诊断/u,
  /未说出口的感情/u,
  /\boceans?\b/iu,
  /\blighthouse[\s-]+myster(?:y|ies)\b/iu,
  /\bpsychological[\s-]+diagnos(?:is|es|tic)\b/iu,
  /\bunspoken[\s-]+feelings?\b/iu,
] as const;

export function containsLegacyStory(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US');
  return (
    LEGACY_CHINESE_TERMS.some((term) => normalized.includes(term)) ||
    LEGACY_CHINESE_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    LEGACY_ENGLISH_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

/** Public archive content that must not become an agent's autonomous personal memory. */
export function containsArchivedEventMemory(value: string): boolean {
  const normalized = value.normalize('NFKC');
  return ARCHIVED_EVENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

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

/** Prompt-only isolation for stored conversation rows. The database rows are never mutated. */
export function filterForbiddenPriorMessages<T extends { text: string }>(
  messages: readonly T[],
): T[] {
  return messages.flatMap((message) => {
    const sanitized = sanitizeConversationText(message.text);
    const clauses = splitConversationClauses(sanitized);
    const ordinaryClauses = clauses.filter((clause) => !containsForbiddenAutonomousMemory(clause));
    if (ordinaryClauses.length === 0) return [];
    if (ordinaryClauses.length === clauses.length && sanitized === message.text) return [message];
    const chinese = /[\u3400-\u9fff]/u.test(ordinaryClauses.join(''));
    const separator = chinese ? '。' : '. ';
    const terminator = chinese ? '。' : '.';
    return [{ ...message, text: ordinaryClauses.join(separator) + terminator }];
  });
}

export function filterLegacyExperimentClauses(value: string): string {
  const clauses = splitConversationClauses(sanitizeConversationText(value));
  const ordinaryClauses = clauses.filter(
    (clause) => !containsLegacyStory(clause) && !containsArchivedEventMemory(clause),
  );
  return ordinaryClauses.length > 0 ? `${ordinaryClauses.join('。')}。` : '';
}
