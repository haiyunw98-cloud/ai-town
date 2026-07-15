import {
  buildEventDecisionPrompt,
  requestEventDecision,
} from './model';
import { LLMConfig } from '../util/llmConfig';

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
});
