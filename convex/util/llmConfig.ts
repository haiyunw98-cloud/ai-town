export type LLMProvider = 'openai' | 'together' | 'ollama' | 'custom';
export type Env = Record<string, string | undefined>;

export interface LLMConfig {
  provider: LLMProvider;
  url: string;
  chatModel: string;
  embeddingModel: string;
  embeddingDimension: number;
  reasoningEffort?: 'none';
  stopWords: string[];
  apiKey: string | undefined;
}

const DEFAULT_DIMENSIONS: Record<Exclude<LLMProvider, 'custom'>, number> = {
  openai: 1536,
  together: 768,
  ollama: 1024,
};

function resolveProvider(env: Env): LLMProvider {
  const explicit = env.LLM_PROVIDER;
  if (explicit) {
    if (['openai', 'together', 'ollama', 'custom'].includes(explicit)) {
      return explicit as LLMProvider;
    }
    throw new Error(
      `不支持的 LLM_PROVIDER: ${explicit}. Expected openai, together, ollama, or custom.`,
    );
  }
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.TOGETHER_API_KEY) return 'together';
  if (env.LLM_API_URL) return 'custom';
  return 'ollama';
}

function requireValue(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}（${name} is required）。`);
  return value;
}

function parseDimension(raw: string | undefined, name: string, fallback?: number): number {
  if (raw === undefined && fallback !== undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数（must be a positive integer）。`);
  }
  return value;
}

export function resolveEmbeddingDimension(env: Env = process.env): number {
  const provider = resolveProvider(env);
  if (provider === 'openai') {
    return parseDimension(
      env.OPENAI_EMBEDDING_DIMENSION,
      'OPENAI_EMBEDDING_DIMENSION',
      DEFAULT_DIMENSIONS.openai,
    );
  }
  if (provider === 'together') {
    return parseDimension(
      env.TOGETHER_EMBEDDING_DIMENSION,
      'TOGETHER_EMBEDDING_DIMENSION',
      DEFAULT_DIMENSIONS.together,
    );
  }
  if (provider === 'ollama') {
    return parseDimension(
      env.OLLAMA_EMBEDDING_DIMENSION,
      'OLLAMA_EMBEDDING_DIMENSION',
      DEFAULT_DIMENSIONS.ollama,
    );
  }
  return parseDimension(env.LLM_EMBEDDING_DIMENSION, 'LLM_EMBEDDING_DIMENSION');
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

export function resolveLLMConfig(env: Env = process.env): LLMConfig {
  const provider = resolveProvider(env);

  if (provider === 'openai') {
    const embeddingDimension = resolveEmbeddingDimension(env);
    return {
      provider,
      url: normalizeBaseUrl(env.OPENAI_API_URL ?? 'https://api.openai.com'),
      chatModel: env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini',
      embeddingModel: env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
      embeddingDimension,
      stopWords: [],
      apiKey: requireValue(env, 'OPENAI_API_KEY'),
    };
  }

  if (provider === 'together') {
    const embeddingDimension = resolveEmbeddingDimension(env);
    return {
      provider,
      url: normalizeBaseUrl(env.TOGETHER_API_URL ?? 'https://api.together.xyz'),
      chatModel: env.TOGETHER_CHAT_MODEL ?? 'meta-llama/Llama-3-8b-chat-hf',
      embeddingModel:
        env.TOGETHER_EMBEDDING_MODEL ?? 'togethercomputer/m2-bert-80M-8k-retrieval',
      embeddingDimension,
      stopWords: ['<|eot_id|>'],
      apiKey: requireValue(env, 'TOGETHER_API_KEY'),
    };
  }

  if (provider === 'custom') {
    const url = normalizeBaseUrl(requireValue(env, 'LLM_API_URL'));
    const chatModel = requireValue(env, 'LLM_MODEL');
    const embeddingModel = requireValue(env, 'LLM_EMBEDDING_MODEL');
    const embeddingDimension = resolveEmbeddingDimension(env);
    return {
      provider,
      url,
      chatModel,
      embeddingModel,
      embeddingDimension,
      stopWords: [],
      apiKey: env.LLM_API_KEY?.trim() || undefined,
    };
  }

  const embeddingDimension = resolveEmbeddingDimension(env);
  return {
    provider,
    url: normalizeBaseUrl(env.OLLAMA_HOST ?? 'http://127.0.0.1:11434'),
    chatModel: env.OLLAMA_MODEL ?? 'qwen3.5:9b',
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL ?? 'mxbai-embed-large',
    embeddingDimension,
    reasoningEffort: 'none',
    stopWords: ['<|eot_id|>', '<|im_end|>'],
    apiKey: undefined,
  };
}

export function sanitizeProviderError(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-zA-Z0-9_-]+\b/g, '[REDACTED]')
    .slice(0, 500);
}
