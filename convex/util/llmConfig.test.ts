import {
  resolveEmbeddingDimension,
  resolveLLMConfig,
  sanitizeProviderError,
} from './llmConfig';

describe('resolveLLMConfig', () => {
  test('defaults to local Ollama with a Chinese-capable chat model', () => {
    expect(resolveLLMConfig({})).toEqual(
      expect.objectContaining({
        provider: 'ollama',
        url: 'http://127.0.0.1:11434',
        chatModel: 'qwen3.5:9b',
        embeddingModel: 'mxbai-embed-large',
        embeddingDimension: 1024,
        apiKey: undefined,
      }),
    );
  });

  test('resolves OpenAI from an explicit provider', () => {
    expect(resolveLLMConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'secret' })).toEqual(
      expect.objectContaining({
        provider: 'openai',
        url: 'https://api.openai.com',
        chatModel: 'gpt-4o-mini',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 1536,
      }),
    );
  });

  test('resolves Together.ai and removes trailing URL slashes', () => {
    const config = resolveLLMConfig({
      LLM_PROVIDER: 'together',
      TOGETHER_API_KEY: 'secret',
      TOGETHER_API_URL: 'https://api.together.xyz///',
    });
    expect(config.provider).toBe('together');
    expect(config.url).toBe('https://api.together.xyz');
    expect(config.embeddingDimension).toBe(768);
  });

  test('supports key-free local OpenAI-compatible endpoints', () => {
    expect(
      resolveLLMConfig({
        LLM_PROVIDER: 'custom',
        LLM_API_URL: 'http://127.0.0.1:1234/v1/',
        LLM_MODEL: 'qwen-local',
        LLM_EMBEDDING_MODEL: 'text-embedding-local',
        LLM_EMBEDDING_DIMENSION: '1024',
      }),
    ).toEqual(
      expect.objectContaining({
        provider: 'custom',
        url: 'http://127.0.0.1:1234',
        apiKey: undefined,
        embeddingDimension: 1024,
      }),
    );
  });

  test('requires provider-specific values without leaking secrets', () => {
    const secret = 'sk-super-secret';
    expect(() => resolveLLMConfig({ LLM_PROVIDER: 'openai' })).toThrow('OPENAI_API_KEY');
    try {
      resolveLLMConfig({ LLM_PROVIDER: 'custom', LLM_API_KEY: secret });
    } catch (error) {
      expect(String(error)).toContain('LLM_API_URL');
      expect(String(error)).not.toContain(secret);
    }
  });

  test.each(['0', '-1', '1.5', 'abc'])('rejects invalid embedding dimension %s', (dimension) => {
    expect(() =>
      resolveEmbeddingDimension({
        LLM_PROVIDER: 'ollama',
        OLLAMA_EMBEDDING_DIMENSION: dimension,
      }),
    ).toThrow('OLLAMA_EMBEDDING_DIMENSION');
  });
});

describe('sanitizeProviderError', () => {
  test('redacts bearer tokens and truncates provider responses', () => {
    const result = sanitizeProviderError(`Bearer sk-secret ${'x'.repeat(700)}`);
    expect(result).not.toContain('sk-secret');
    expect(result).toContain('[REDACTED]');
    expect(result.length).toBeLessThanOrEqual(500);
  });
});
