import { readFileSync } from 'node:fs';
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

describe('social observation model boundary', () => {
  test('bounds a 20k digest and requires cautious fact-only prose', () => {
    const digest = `BEGIN:${'事实。'.repeat(7_000)}:CUT_OFF_MARKER`;

    const prompt = buildSocialObservationPrompt(digest);

    expect(Array.from(prompt).length).toBeLessThan(14_000);
    expect(prompt).toContain('BEGIN:');
    expect(prompt).not.toContain('CUT_OFF_MARKER');
    expect(prompt).toContain('不得补写');
    expect(prompt).toContain('不得作因果定论');
    expect(prompt).toContain('记录显示');
    expect(prompt).toContain('可能');
    expect(prompt).toContain('尚需持续观察');
    expect(prompt).toContain('800–1400');
    expect(prompt).toContain('不加 Markdown 标题');
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

  test('exports the generate action without a paid DeepSeek path', () => {
    const source = readFileSync('convex/socialObservations.ts', 'utf8');

    expect(generate).toBeDefined();
    expect(source).toMatch(/export const generate\s*=\s*action\s*\(/u);
    expect(source.toLowerCase()).not.toContain('deepseek');
    expect(source).not.toContain('worldStatus');
  });
});
