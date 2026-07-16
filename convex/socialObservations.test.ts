import { readFileSync } from 'node:fs';
import { jest } from '@jest/globals';
import { LLMConfig } from './util/llmConfig';
import {
  buildSocialObservationPrompt,
  generate,
  requestSocialObservation,
} from './socialObservations';

const ollamaConfig: LLMConfig = {
  provider: 'ollama',
  url: 'http://127.0.0.1:11434',
  chatModel: 'qwen3.5:9b',
  embeddingModel: 'mxbai-embed-large',
  embeddingDimension: 1024,
  reasoningEffort: 'none',
  stopWords: [],
  apiKey: undefined,
};

const registeredGenerate = generate as typeof generate & {
  exportArgs: () => string;
  _handler: (
    ctx: unknown,
    args: { digest: string },
  ) => Promise<{
    source: 'model' | 'fallback';
    narrative: string;
  }>;
};

describe('social observation model boundary', () => {
  test('bounds the exact digest section without splitting Unicode and locks every prompt rule', () => {
    const digest = `BEGIN:${'😀'.repeat(13_000)}:CUT_OFF_MARKER`;

    const prompt = buildSocialObservationPrompt(digest);
    const digestMatch = prompt.match(/事实摘要开始：\n([\s\S]*)\n事实摘要结束。/u);
    expect(digestMatch).not.toBeNull();
    const actualDigest = digestMatch![1];

    expect(Array.from(prompt).length).toBeLessThan(14_000);
    expect(Array.from(actualDigest).length).toBeLessThanOrEqual(12_000);
    expect(actualDigest).toContain('BEGIN:');
    expect(actualDigest).not.toContain('CUT_OFF_MARKER');
    expect(
      Array.from(actualDigest).every((character) => {
        const codePoint = character.codePointAt(0)!;
        return codePoint < 0xd800 || codePoint > 0xdfff;
      }),
    ).toBe(true);
    for (const forbiddenAddition of ['人物', '事件', '关系', '动机', '地点']) {
      expect(prompt).toMatch(new RegExp(`不得补写[^。]*${forbiddenAddition}`, 'u'));
    }
    expect(prompt).toMatch(/不得[^。]*心理诊断/u);
    expect(prompt).toMatch(/不得[^。]*价值判断/u);
    expect(prompt).toContain('不得作因果定论');
    expect(prompt).toContain('不得写成论文结论');
    expect(prompt).toContain('记录显示');
    expect(prompt).toContain('可能');
    expect(prompt).toContain('尚需持续观察');
    expect(prompt).toContain('800–1400');
    expect(prompt).toContain('连续观察文字');
    expect(prompt).toContain('不加 Markdown 标题、列表或其他格式');
  });

  test('uses Ollama once with the fixed Gemma model for valid output', async () => {
    const bodies: Array<Record<string, unknown>> = [];

    const result = await requestSocialObservation('镇民在广场交换了三次物品。', {
      getConfig: () => ollamaConfig,
      complete: async (body) => {
        bodies.push(body);
        return { content: ' 记录显示，广场上的交换在这段时间内重复出现。 ' };
      },
    });

    expect(result).toEqual({
      source: 'model',
      narrative: '记录显示，广场上的交换在这段时间内重复出现。',
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual(
      expect.objectContaining({
        model: 'gemma4:12b',
        max_tokens: 1600,
        temperature: 0.35,
        stream: false,
      }),
    );
  });

  test.each(['openai', 'together', 'custom'] as const)(
    'does not call completion for %s',
    async (provider) => {
      let calls = 0;

      const result = await requestSocialObservation('事实摘要', {
        getConfig: () => ({ ...ollamaConfig, provider }),
        complete: async () => {
          calls += 1;
          return { content: '不应出现' };
        },
      });

      expect(calls).toBe(0);
      expect(result).toEqual({ source: 'fallback', narrative: '' });
    },
  );

  test.each([
    ['missing content', { content: undefined }],
    ['null content', { content: null }],
    ['numeric content', { content: 42 }],
    ['whitespace content', { content: ' \n\t ' }],
  ])('falls back for %s', async (_name, completion) => {
    const result = await requestSocialObservation('事实摘要', {
      getConfig: () => ollamaConfig,
      complete: async () => completion as unknown as { content: string },
    });

    expect(result).toEqual({ source: 'fallback', narrative: '' });
  });

  test('falls back when completion throws', async () => {
    const result = await requestSocialObservation('事实摘要', {
      getConfig: () => ollamaConfig,
      complete: async () => {
        throw new Error('offline');
      },
    });

    expect(result).toEqual({ source: 'fallback', narrative: '' });
  });

  test('bounds unexpectedly long model output', async () => {
    const result = await requestSocialObservation('事实摘要', {
      getConfig: () => ollamaConfig,
      complete: async () => ({ content: `  ${'观察'.repeat(4_000)}  ` }),
    });

    expect(result.source).toBe('model');
    expect(Array.from(result.narrative)).toHaveLength(6_000);
    expect(result.narrative).not.toMatch(/^\s|\s$/u);
  });

  test('exports a generate action with exactly one required string digest argument', () => {
    expect(JSON.parse(registeredGenerate.exportArgs())).toEqual({
      type: 'object',
      value: {
        digest: {
          fieldType: { type: 'string' },
          optional: false,
        },
      },
    });
  });

  test('runs the registered action handler through the local Gemma request path', async () => {
    const originalFetch = globalThis.fetch;
    const originalProvider = process.env.LLM_PROVIDER;
    const originalOllamaHost = process.env.OLLAMA_HOST;
    const fetchMock = jest.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: ' 记录显示，测试居民今天经过了广场。 ' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const digest = '测试居民今天经过了广场。';

    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = 'http://test.local';
    globalThis.fetch = fetchMock;
    try {
      const result = await registeredGenerate._handler({}, { digest });

      expect(result).toEqual({
        source: 'model',
        narrative: '记录显示，测试居民今天经过了广场。',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://test.local/v1/chat/completions');
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ content: string }>;
      };
      expect(body.model).toBe('gemma4:12b');
      expect(body.messages.some((message) => message.content.includes(digest))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvironmentVariable('LLM_PROVIDER', originalProvider);
      restoreEnvironmentVariable('OLLAMA_HOST', originalOllamaHost);
    }
  });

  test('has no paid DeepSeek or world-status path in the action source', () => {
    const source = readFileSync('convex/socialObservations.ts', 'utf8');

    expect(source).toMatch(/export const generate\s*=\s*action\s*\(/u);
    expect(source.toLowerCase()).not.toContain('deepseek');
    expect(source).not.toContain('worldStatus');
  });
});

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
