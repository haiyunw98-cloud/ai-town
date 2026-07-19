import type { LLMConfig } from '../util/llm';
import { dailyEventTemplates } from './dailyTemplates';
import {
  buildDailyThemePrompt,
  fallbackDailyTheme,
  requestDailyTheme,
} from './dailyTheme';

const template = dailyEventTemplates[0];
const ollamaGemma: LLMConfig = {
  provider: 'ollama',
  url: 'http://127.0.0.1:11434',
  chatModel: 'gemma4:12b',
  embeddingModel: 'mxbai-embed-large',
  embeddingDimension: 1024,
  reasoningEffort: 'none',
  stopWords: [],
  apiKey: undefined,
};

describe('daily event theme boundary', () => {
  test('accepts only bounded JSON from local Ollama Gemma', async () => {
    const bodies: unknown[] = [];
    const result = await requestDailyTheme(template, '2026-07-17', {
      getConfig: () => ollamaGemma,
      complete: async (body) => {
        bodies.push(body);
        return {
          content:
            '{"name":"荷香协作赛","announcement":"安全完成每一关，退出比赛的居民会进入观众席。"}',
        };
      },
    });

    expect(result).toEqual({
      name: '荷香协作赛',
      announcement: '安全完成每一关，退出比赛的居民会进入观众席。',
      source: 'model',
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual(
      expect.objectContaining({
        model: 'gemma4:12b',
        max_tokens: 180,
        response_format: { type: 'json_object' },
        stream: false,
      }),
    );
  });

  test.each([
    ['paid provider', { ...ollamaGemma, provider: 'openai' as const }],
    ['custom provider', { ...ollamaGemma, provider: 'custom' as const }],
    ['a non-Gemma Ollama model', { ...ollamaGemma, chatModel: 'qwen3.5:9b' }],
    ['a remotely prefixed model', { ...ollamaGemma, chatModel: 'remote/gemma4:12b' }],
    ['a case-variant model', { ...ollamaGemma, chatModel: 'Gemma4:12b' }],
    ['an HTTPS endpoint', { ...ollamaGemma, url: 'https://127.0.0.1:11434' }],
    ['a remote IPv4 endpoint', { ...ollamaGemma, url: 'http://192.168.1.8:11434' }],
    ['a remote hostname', { ...ollamaGemma, url: 'http://ollama.example.com:11434' }],
    ['a localhost suffix trap', { ...ollamaGemma, url: 'http://localhost.example.com' }],
    ['an endpoint with remote userinfo', { ...ollamaGemma, url: 'http://remote@localhost:11434' }],
  ])('does not call the model for %s', async (_label, config) => {
    let calls = 0;
    await expect(
      requestDailyTheme(template, '2026-07-17', {
        getConfig: () => config,
        complete: async () => {
          calls += 1;
          return { content: '{}' };
        },
      }),
    ).resolves.toEqual(fallbackDailyTheme(template));
    expect(calls).toBe(0);
  });

  test.each([
    'http://127.0.0.1:11434',
    'http://localhost:11434/v1',
    'http://[::1]:11434/ollama',
  ])('allows the exact Gemma model at local endpoint %s', async (url) => {
    let calls = 0;
    const result = await requestDailyTheme(template, '2026-07-17', {
      getConfig: () => ({ ...ollamaGemma, url }),
      complete: async () => {
        calls += 1;
        return {
          content:
            '{"name":"荷香协作赛","announcement":"安全完成每一关，退出比赛的居民会进入观众席。"}',
        };
      },
    });
    expect(calls).toBe(1);
    expect(result.source).toBe('model');
  });

  test.each([
    ['invalid JSON', 'not-json'],
    ['JSON wrapped in markdown', '```json\n{"name":"荷香赛","announcement":"安全完成活动并在结束后返回日常生活。"}\n```'],
    ['missing fields', '{"name":"荷香赛"}'],
    ['too short a name', '{"name":"荷","announcement":"安全完成活动并在结束后返回日常生活。"}'],
    ['too long a name', `{"name":"${'荷'.repeat(21)}","announcement":"安全完成活动并在结束后返回日常生活。"}`],
    ['too short an announcement', '{"name":"荷香赛","announcement":"安全完成。"}'],
    ['too long an announcement', `{"name":"荷香赛","announcement":"${'安全协作'.repeat(21)}"}`],
    ['unsafe wording', '{"name":"荷香流血赛","announcement":"安全完成活动并在结束后返回日常生活。"}'],
    ['unsafe announcement', '{"name":"荷香赛","announcement":"有人受伤才算赢，退出者进入观众席。"}'],
  ])('falls back for %s', async (_label, content) => {
    await expect(
      requestDailyTheme(template, '2026-07-17', {
        getConfig: () => ollamaGemma,
        complete: async () => ({ content }),
      }),
    ).resolves.toEqual(fallbackDailyTheme(template));
  });

  test('falls back when config lookup or completion throws', async () => {
    await expect(
      requestDailyTheme(template, '2026-07-17', {
        getConfig: () => {
          throw new Error('offline');
        },
        complete: async () => ({ content: '{}' }),
      }),
    ).resolves.toEqual(fallbackDailyTheme(template));

    await expect(
      requestDailyTheme(template, '2026-07-17', {
        getConfig: () => ollamaGemma,
        complete: async () => {
          throw new Error('offline');
        },
      }),
    ).resolves.toEqual(fallbackDailyTheme(template));
  });

  test('prompt fixes the template contract and requests JSON only', () => {
    const prompt = buildDailyThemePrompt(template, '2026-07-17');
    expect(prompt).toContain(template.name);
    expect(prompt).toContain(template.stages.map((stage) => stage.label).join('、'));
    expect(prompt).toContain('不得改变阶段、淘汰、计分、时间或场地');
    expect(prompt).toContain('只输出 JSON');
  });
});
