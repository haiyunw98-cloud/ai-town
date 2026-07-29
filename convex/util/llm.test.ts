import { jest } from '@jest/globals';
import * as llmModule from './llm';
import { LLMConfig } from './llmConfig';

const ollamaConfig: LLMConfig = {
  provider: 'ollama',
  url: 'http://ollama.test',
  chatModel: 'ignored-model',
  embeddingModel: 'mxbai-embed-large',
  embeddingDimension: 1024,
  reasoningEffort: 'none',
  stopWords: [],
  apiKey: undefined,
};

const llm = llmModule as unknown as {
  assertLocalOllamaProvider?: (dependencies?: { getConfig: () => LLMConfig }) => LLMConfig;
  localChatCompletionOnce?: (
    body: {
      model: string;
      messages: Array<{ role: 'user'; content: string }>;
      stream?: false;
      max_tokens?: number;
      temperature?: number;
    },
    dependencies?: {
      getConfig: () => LLMConfig;
      fetch: typeof fetch;
    },
  ) => Promise<{ content: string; retries: number; ms: number }>;
};

describe('localChatCompletionOnce', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(['openai', 'together', 'custom'] as const)(
    'shared preflight rejects %s with a stable content-free error',
    (provider) => {
      expect(llm.assertLocalOllamaProvider).toBeDefined();
      if (!llm.assertLocalOllamaProvider) return;

      expect(() =>
        llm.assertLocalOllamaProvider?.({
          getConfig: () => ({ ...ollamaConfig, provider }),
        }),
      ).toThrow(new Error('local-provider-unavailable'));
    },
  );

  test('returns one valid Ollama completion with the explicit model', async () => {
    expect(llm.localChatCompletionOnce).toBeDefined();
    if (!llm.localChatCompletionOnce) return;
    const fetchMock = jest.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: { content: '日常回复' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const result = await llm.localChatCompletionOnce(
      {
        model: 'gemma4:12b',
        messages: [{ role: 'user', content: '聊聊工作' }],
        stream: false,
      },
      { getConfig: () => ollamaConfig, fetch: fetchMock },
    );

    expect(result).toEqual({ content: '日常回复', retries: 0, ms: expect.any(Number) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://ollama.test/api/chat');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      model: 'gemma4:12b',
      stream: false,
      think: false,
      options: {},
    });
  });

  test('uses Ollama native no-thinking mode so short resident replies are not consumed by reasoning', async () => {
    expect(llm.localChatCompletionOnce).toBeDefined();
    if (!llm.localChatCompletionOnce) return;
    const fetchMock = jest.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: { content: '我来接力，好让药材早点送到街坊手里。' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const result = await llm.localChatCompletionOnce(
      {
        model: 'gemma4:12b',
        messages: [{ role: 'user', content: '为什么参加接力？' }],
        max_tokens: 120,
        temperature: 0.7,
      },
      { getConfig: () => ollamaConfig, fetch: fetchMock },
    );

    expect(result.content).toContain('接力');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      think: false,
      options: { num_predict: 120, temperature: 0.7 },
    });
  });

  test.each(['openai', 'together', 'custom'] as const)(
    'rejects %s before performing any fetch',
    async (provider) => {
      expect(llm.localChatCompletionOnce).toBeDefined();
      if (!llm.localChatCompletionOnce) return;
      const fetchMock = jest.fn<typeof fetch>();

      await expect(
        llm.localChatCompletionOnce(
          {
            model: 'gemma4:12b',
            messages: [{ role: 'user', content: 'never sent' }],
            stream: false,
          },
          { getConfig: () => ({ ...ollamaConfig, provider }), fetch: fetchMock },
        ),
      ).rejects.toThrow('local-provider-unavailable');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test('performs one fetch on a 500 and never logs the raw provider body', async () => {
    expect(llm.localChatCompletionOnce).toBeDefined();
    if (!llm.localChatCompletionOnce) return;
    const secret = 'raw-provider-body sk-secret-token';
    const fetchMock = jest.fn<typeof fetch>(() =>
      Promise.resolve(new Response(secret, { status: 500 })),
    );
    const logSpies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'debug').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];

    let failure: unknown;
    try {
      await llm.localChatCompletionOnce(
        {
          model: 'gemma4:12b',
          messages: [{ role: 'user', content: 'one attempt' }],
          stream: false,
        },
        { getConfig: () => ollamaConfig, fetch: fetchMock },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('local-chat-completion-failed:500');
    expect((failure as Error).message).not.toContain(secret);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const logged = logSpies
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .join(' ');
    expect(logged).not.toContain(secret);
  });

  test.each([
    ['invalid JSON', 'INVALID_JSON_SENTINEL', 'text/plain'],
    ['missing content', JSON.stringify({ message: {} }), 'application/json'],
  ])('returns a content-free error for %s', async (_name, responseBody, contentType) => {
    expect(llm.localChatCompletionOnce).toBeDefined();
    if (!llm.localChatCompletionOnce) return;
    const fetchMock = jest.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(responseBody, { status: 200, headers: { 'Content-Type': contentType } }),
      ),
    );

    await expect(
      llm.localChatCompletionOnce(
        {
          model: 'gemma4:12b',
          messages: [{ role: 'user', content: 'test invalid response' }],
          stream: false,
        },
        { getConfig: () => ollamaConfig, fetch: fetchMock },
      ),
    ).rejects.toThrow(new Error('local-chat-completion-invalid-response'));
  });
});
