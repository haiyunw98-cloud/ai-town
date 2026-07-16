import { v } from 'convex/values';
import { action } from './_generated/server';
import { chatCompletion, CreateChatCompletionRequest, getLLMConfig, LLMConfig } from './util/llm';

export type SocialObservation = {
  source: 'model' | 'fallback';
  narrative: string;
};

type SocialObservationCompletionBody = Omit<CreateChatCompletionRequest, 'model' | 'stream'> & {
  model: string;
  stream: false;
};

type SocialObservationDependencies = {
  getConfig: () => LLMConfig;
  complete: (body: SocialObservationCompletionBody) => Promise<unknown>;
};

const MAX_DIGEST_CHARACTERS = 12_000;
const MAX_NARRATIVE_CHARACTERS = 6_000;
const SOCIAL_OBSERVATION_MODEL = 'gemma4:12b';
const fallback: SocialObservation = { source: 'fallback', narrative: '' };

const defaultDependencies: SocialObservationDependencies = {
  getConfig: getLLMConfig,
  complete: (body) => chatCompletion(body),
};

export function buildSocialObservationPrompt(digest: string) {
  const boundedDigest = truncateCharacters(digest, MAX_DIGEST_CHARACTERS);
  return [
    '请根据下面的事实摘要，写一段社会观察日志。只能依据摘要中明确记录的事实，不得补写人物、事件、关系、动机或地点。',
    '措辞必须保持审慎：使用“记录显示”“可能”“尚需持续观察”等表述。不得进行心理诊断、价值判断，不得作因果定论，也不得写成论文结论。',
    '输出 800–1400 个中文字符的连续观察文字，不加 Markdown 标题、列表或其他格式。',
    '事实摘要开始：',
    boundedDigest,
    '事实摘要结束。',
  ].join('\n');
}

export async function requestSocialObservation(
  digest: string,
  dependencies: SocialObservationDependencies = defaultDependencies,
): Promise<SocialObservation> {
  try {
    const config = dependencies.getConfig();
    if (config.provider !== 'ollama') return fallback;

    const result = await dependencies.complete({
      model: SOCIAL_OBSERVATION_MODEL,
      messages: [
        {
          role: 'system',
          content: '你是灯塔镇的社会观察记录员，只能整理给定事实，并使用审慎的简体中文。',
        },
        { role: 'user', content: buildSocialObservationPrompt(digest) },
      ],
      max_tokens: 1600,
      temperature: 0.35,
      stream: false,
    });

    if (!hasStringContent(result) || !result.content.trim()) return fallback;
    const narrative = truncateCharacters(result.content.trim(), MAX_NARRATIVE_CHARACTERS).trim();
    if (!narrative) return fallback;
    return { source: 'model', narrative };
  } catch {
    return fallback;
  }
}

function hasStringContent(value: unknown): value is { content: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    typeof value.content === 'string'
  );
}

function truncateCharacters(value: string, limit: number) {
  return Array.from(value.slice(0, limit * 2))
    .slice(0, limit)
    .join('');
}

export const generate = action({
  args: { digest: v.string() },
  handler: async (_ctx, { digest }) => requestSocialObservation(digest),
});
