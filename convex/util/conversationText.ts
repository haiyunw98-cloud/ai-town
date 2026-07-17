const OPEN_PARENTHESIS = new Set(['(', '（']);
const CLOSE_PARENTHESIS = new Set([')', '）']);
const CLOSING_QUOTE = new Set(['"', "'", '”', '’']);
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

export function sanitizeConversationText(value: string): string {
  return removeStageDirections(value).replace(/\s+/gu, ' ').trim();
}

export function hasMeaningfulConversationText(value: string): boolean {
  return Array.from(value).some((character) => SUBSTANTIVE_CHARACTER.test(character));
}

export type GraphemeSegmenter = { segment(value: string): Iterable<{ segment: string }> };

type GraphemeSegmenterConstructor = new (
  locale?: string | string[],
  options?: { granularity: 'grapheme' },
) => GraphemeSegmenter;

const GraphemeSegmenter = (
  Intl as unknown as { Segmenter?: GraphemeSegmenterConstructor }
).Segmenter;
const conversationGraphemeSegmenter = GraphemeSegmenter
  ? new GraphemeSegmenter('zh-CN', { granularity: 'grapheme' })
  : null;

function extendsFallbackGrapheme(value: string): boolean {
  const codePoint = value.codePointAt(0) ?? 0;
  return (
    /\p{Mark}/u.test(value)
    || codePoint === 0xfe0e
    || codePoint === 0xfe0f
    || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
  );
}

function isRegionalIndicator(value: string): boolean {
  const codePoint = value.codePointAt(0) ?? 0;
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
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
    if (isRegionalIndicator(codePoint)) {
      const previous = Array.from(clusters[lastIndex]);
      if (previous.length === 1 && isRegionalIndicator(previous[0])) {
        clusters[lastIndex] += codePoint;
      } else {
        clusters.push(codePoint);
      }
      joinNext = false;
    } else if (codePoint === '\u200d') {
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

export function segmentConversationGraphemes(
  value: string,
  segmenter: GraphemeSegmenter | null = conversationGraphemeSegmenter,
): string[] {
  if (!segmenter) return fallbackGraphemes(value);
  return Array.from(segmenter.segment(value), ({ segment }) => segment);
}

const SHORT_ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'st', 'no', 'vs', 'etc',
]);

export function isConversationSentencePeriod(characters: string[], index: number): boolean {
  const previous = characters[index - 1] ?? '';
  const next = characters[index + 1] ?? '';
  if (previous === '.' || next === '.') return false;
  if (/\d/u.test(next)) return false;
  if (/[A-Za-z]/u.test(previous) && /[A-Za-z]/u.test(next)) return false;

  const remainder = characters.slice(index + 1).join('');
  if (!/\S/u.test(remainder)) return true;
  const prefix = characters.slice(0, index).join('');
  const word = prefix.match(/([A-Za-z]+)$/u)?.[1].toLocaleLowerCase('en-US');
  if (word && SHORT_ABBREVIATIONS.has(word)) return false;
  if (/(?:\b[A-Za-z]\.)+[A-Za-z]$/u.test(prefix)) return false;
  return true;
}

export function splitConversationClauses(value: string): string[] {
  const characters = Array.from(value);
  const clauses: string[] = [];
  let clause = '';
  const finishClause = () => {
    const trimmed = clause.trim();
    if (trimmed) clauses.push(trimmed);
    clause = '';
  };

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const isPeriodBoundary = character === '.'
      && isConversationSentencePeriod(characters, index);
    const isNumericComma = /[,，]/u.test(character)
      && /\d/u.test(characters[index - 1] ?? '')
      && /\d/u.test(characters[index + 1] ?? '');
    if ((/[。！？!?；;，,\n]/u.test(character) && !isNumericComma) || isPeriodBoundary) {
      while (CLOSING_QUOTE.has(characters[index + 1] ?? '')) {
        index += 1;
        clause += characters[index];
      }
      finishClause();
      continue;
    }
    clause += character;
  }
  finishClause();
  return clauses;
}
