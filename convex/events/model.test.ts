import {
  buildEventDecisionPrompt,
  requestEventDecision,
} from './model';
import { LLMConfig } from '../util/llmConfig';
import { dailyEventTemplates } from './dailyTemplates';

const input = {
  residentId: 'p:1',
  displayName: '顾潮',
  identity: '顾潮是灯塔镇热情好胜的灯笼匠，但不会为了赢让别人受伤。',
  phase: 'secretTrade' as const,
  choices: [
    { id: 'share', label: '把线索分享给临时盟友' },
    { id: 'keep', label: '保留线索独自行动' },
  ],
};

const ollamaConfig: LLMConfig = {
  provider: 'ollama',
  url: 'http://127.0.0.1:11434',
  chatModel: 'gemma4:12b',
  embeddingModel: 'mxbai-embed-large',
  embeddingDimension: 1024,
  reasoningEffort: 'none',
  stopWords: [],
  apiKey: undefined,
};

describe('event model boundary', () => {
  test('builds a short Chinese prompt with finite choices', () => {
    const prompt = buildEventDecisionPrompt(input);
    expect(prompt).toContain(input.identity);
    expect(prompt).toContain('secretTrade');
    expect(prompt).toContain('share');
    expect(prompt).toContain('keep');
    expect(prompt).toContain('60 个中文字符');
    expect(prompt).toContain('只选择上面列出的 choiceId');
  });

  test('uses Ollama for a valid bounded decision', async () => {
    const bodies: unknown[] = [];
    const result = await requestEventDecision(input, {
      getConfig: () => ollamaConfig,
      complete: async (body) => {
        bodies.push(body);
        return { content: '{"choiceId":"share","publicQuote":"灯火要亮，线索也该照见同伴。"}' };
      },
    });
    expect(result).toEqual({
      choiceId: 'share',
      publicQuote: '灯火要亮，线索也该照见同伴。',
      source: 'model',
    });
    expect(bodies[0]).toEqual(expect.objectContaining({ max_tokens: 96 }));
  });

  test('falls back locally for paid providers and malformed output', async () => {
    let calls = 0;
    const paidResult = await requestEventDecision(input, {
      getConfig: () => ({ ...ollamaConfig, provider: 'openai', apiKey: 'secret' }),
      complete: async () => {
        calls += 1;
        return { content: '{}' };
      },
    });
    expect(calls).toBe(0);
    expect(input.choices.map((choice) => choice.id)).toContain(paidResult.choiceId);
    expect(paidResult.source).toBe('fallback');

    const malformedResult = await requestEventDecision(input, {
      getConfig: () => ollamaConfig,
      complete: async () => ({ content: 'not-json' }),
    });
    expect(malformedResult.source).toBe('fallback');
    expect(Array.from(malformedResult.publicQuote).length).toBeLessThanOrEqual(60);
  });

  test('accepts readonly daily-stage choices without mutating them', async () => {
    const stage = dailyEventTemplates[0].stages[1];
    const result = await requestEventDecision(
      {
        residentId: 'p:lin',
        displayName: '林澜',
        identity: '谨慎而愿意合作。',
        phase: stage.id,
        choices: stage.choices,
      },
      {
        getConfig: () => ollamaConfig,
        complete: async () => ({
          content: '{"choiceId":"steady","publicQuote":"我先看清脚下，再跟上大家。"}',
        }),
      },
    );

    expect(result).toEqual({
      choiceId: 'steady',
      publicQuote: '我先看清脚下，再跟上大家。',
      source: 'model',
    });
    expect(stage.choices).toEqual([
      { id: 'steady', label: '稳步完成' },
      { id: 'sprint', label: '加快节奏' },
    ]);
  });

  test.each(['有人受伤才算赢。', '这关要流血才刺激。', '淘汰者会被处决。', '死亡也无所谓。'])(
    'rejects unsafe model quote: %s',
    async (publicQuote) => {
      const stage = dailyEventTemplates[0].stages[1];
      const result = await requestEventDecision(
        {
          residentId: 'p:lin',
          displayName: '林澜',
          identity: '谨慎而愿意合作。',
          phase: stage.id,
          choices: stage.choices,
        },
        {
          getConfig: () => ollamaConfig,
          complete: async () => ({
            content: JSON.stringify({ choiceId: 'steady', publicQuote }),
          }),
        },
      );

      expect(result.source).toBe('fallback');
      expect(result.publicQuote).not.toMatch(/死亡|受伤|处决|流血/u);
    },
  );
});
