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
  '异变',
  '谜团',
  '谜题',
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
  /\banomal(?:y|ies|ous)\b/u,
  /\blost[\s/-]+(?:sea[\s/-]+)?route\b/u,
  /\bnight[\s/-]+sailing\b/u,
  /\bfog[\s/-]+tide\b/u,
] as const;

const ARCHIVED_EVENT_PATTERNS = [
  /(?:百万金贝|一百万金贝)/u,
  /寻宝(?:赛|比赛|竞赛)/u,
  /\bmillion[\s-]+(?:gold(?:en)?[\s-]+)?shells?\b/iu,
  /\btreasure[\s-]+(?:hunt|contest)\b/iu,
  /\b(?:lighthouse[\s-]+town[\s-]+)?million[\s-]+gold(?:en)?[\s-]+shell(?:s)?[\s-]+treasure[\s-]+hunt(?:[\s-]+(?:race|competition))?\b/iu,
] as const;

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

export function containsLegacyStory(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US');
  return LEGACY_CHINESE_TERMS.some((term) => normalized.includes(term))
    || LEGACY_ENGLISH_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Public archive content that must not become an agent's autonomous personal memory. */
export function containsArchivedEventMemory(value: string): boolean {
  const normalized = value.normalize('NFKC');
  return ARCHIVED_EVENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function containsForbiddenAutonomousMemory(value: string): boolean {
  const normalized = value.normalize('NFKC');
  return containsLegacyStory(normalized)
    || containsArchivedEventMemory(normalized)
    || AUTONOMOUS_MEMORY_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function filterLegacyMemories<T extends { description: string }>(
  memories: readonly T[],
): T[] {
  return memories.filter((memory) => !containsForbiddenAutonomousMemory(memory.description));
}

export function filterLegacyExperimentClauses(value: string): string {
  const clauses = splitConversationClauses(sanitizeConversationText(value));
  const ordinaryClauses = clauses.filter((clause) =>
    !containsLegacyStory(clause) && !containsArchivedEventMemory(clause),
  );
  return ordinaryClauses.length > 0 ? `${ordinaryClauses.join('。')}。` : '';
}
