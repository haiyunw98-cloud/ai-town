import { readFileSync } from 'node:fs';
import * as agentOperationsModule from '../aiTown/agentOperations';
import * as memoryModule from './memory';
import * as conversationModule from './conversation';
import { MAX_CONVERSATION_MESSAGES } from '../constants';

type Reason = 'world-correction' | 'empty' | 'legacy-story' | 'too-long';

const agentOperations = agentOperationsModule as unknown as {
  generateValidatedResidentMessage?: (
    args: { kind: 'start' | 'continue' | 'leave' },
    dependencies: {
      generate: () => Promise<string>;
      loadPolicyContext: () => Promise<{ topic: 'work'; observerAskedAboutSea: boolean }>;
      send: (text: string) => Promise<void>;
      recordRejection: (reason: Reason) => Promise<void>;
      reportGenerationUnavailable?: () => void;
    },
  ) => Promise<void>;
  rememberConversationAndRelease?: (dependencies: {
    remember: () => Promise<unknown>;
    release: () => Promise<void>;
  }) => Promise<void>;
  recordConversationPolicyEvent?: {
    _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
};

const memory = memoryModule as unknown as {
  sanitizeMemorySummary?: (raw: string, locale: 'zh-CN' | 'en') => string;
  prepareReflectionInput?: <
    T extends {
      _id: string;
      _creationTime: number;
      importance: number;
      description: string;
    },
  >(
    memories: readonly T[],
    lastReflectionTs?: number,
  ) => { memories: T[]; sumOfImportanceScore: number; statements: string[] };
  reflectionRelatedMemoryIds?: <T extends { _id: string }>(
    memories: readonly T[],
    statementIds: readonly number[],
  ) => string[];
};

describe('final resident send boundary', () => {
  const cases = [
    {
      name: 'valid',
      output: '今天订单已经整理好了。',
      expected: '今天订单已经整理好了。',
      reason: undefined,
    },
    {
      name: 'legacy',
      output: '海潮带来了异常闪光。',
      expected: '不说那些传闻了，我们聊聊工作吧。',
      reason: 'legacy-story',
    },
    { name: 'empty', output: '', expected: '说说工作吧，你最近有什么新鲜事？', reason: 'empty' },
    {
      name: 'too long',
      output: `今天先整理订单。${'接着核对货架和账本，'.repeat(10)}`,
      expected: '今天先整理订单。',
      reason: 'too-long',
    },
  ] as const;

  test.each(cases)(
    'validates $name model output and sends exactly once',
    async ({ output, expected, reason }) => {
      expect(agentOperations.generateValidatedResidentMessage).toBeDefined();
      if (!agentOperations.generateValidatedResidentMessage) return;
      const sent: string[] = [];
      const recorded: Reason[] = [];
      let generations = 0;

      await agentOperations.generateValidatedResidentMessage(
        { kind: 'continue' },
        {
          generate: async () => {
            generations += 1;
            return output;
          },
          loadPolicyContext: async () => ({ topic: 'work', observerAskedAboutSea: false }),
          send: async (text) => void sent.push(text),
          recordRejection: async (value) => void recorded.push(value),
        },
      );

      expect(generations).toBe(1);
      expect(sent).toEqual([expected]);
      expect(recorded).toEqual(reason ? [reason] : []);
      if (reason && output) expect(JSON.stringify({ sent, recorded })).not.toContain(output);
    },
  );

  test('uses one deterministic empty fallback when generation throws without retrying or leaking the error', async () => {
    expect(agentOperations.generateValidatedResidentMessage).toBeDefined();
    if (!agentOperations.generateValidatedResidentMessage) return;
    const secret = 'provider body containing a secret model response';
    const sent: string[] = [];
    const recorded: Reason[] = [];
    const reports: string[] = [];
    let generations = 0;

    await agentOperations.generateValidatedResidentMessage(
      { kind: 'continue' },
      {
        generate: async () => {
          generations += 1;
          throw new Error(secret);
        },
        loadPolicyContext: async () => ({ topic: 'work', observerAskedAboutSea: false }),
        send: async (text) => void sent.push(text),
        recordRejection: async (reason) => void recorded.push(reason),
        reportGenerationUnavailable: () => void reports.push('provider-unavailable'),
      },
    );

    expect(generations).toBe(1);
    expect(sent).toEqual(['说说工作吧，你最近有什么新鲜事？']);
    expect(recorded).toEqual(['empty']);
    expect(reports).toEqual(['provider-unavailable']);
    expect(JSON.stringify({ sent, recorded, reports })).not.toContain(secret);
  });

  test('always releases remember operation after success and failure', async () => {
    expect(agentOperations.rememberConversationAndRelease).toBeDefined();
    if (!agentOperations.rememberConversationAndRelease) return;
    const calls: string[] = [];
    await agentOperations.rememberConversationAndRelease({
      remember: async () => void calls.push('remember'),
      release: async () => void calls.push('release'),
    });
    expect(calls).toEqual(['remember', 'release']);

    calls.length = 0;
    await expect(
      agentOperations.rememberConversationAndRelease({
        remember: async () => {
          calls.push('remember');
          throw new Error('memory failed');
        },
        release: async () => void calls.push('release'),
      }),
    ).rejects.toThrow('memory failed');
    expect(calls).toEqual(['remember', 'release']);
  });
});

describe('policy context and metrics', () => {
  const query = conversationModule as unknown as {
    getConversationPolicyContext?: {
      _handler: (
        ctx: unknown,
        args: { worldId: string; playerId: string; otherPlayerId: string; conversationId: string },
      ) => Promise<{ topic: string; observerAskedAboutSea: boolean }>;
    };
  };

  function fakeContext(topicDetail?: string, latestText = '今天过得怎么样？') {
    const messages = [{ author: 'human', text: latestText, _creationTime: 1 }];
    const topic = topicDetail === undefined ? null : { detail: topicDetail };
    const db = {
      get: async () => ({ players: [{ id: 'human', human: 'token' }] }),
      query: (table: string) => {
        const builder: Record<string, unknown> = {};
        builder.withIndex = (_name: string, apply: (q: { eq: () => unknown }) => unknown) => {
          const chain = { eq: () => chain };
          apply(chain);
          return builder;
        };
        builder.unique = async () => topic;
        builder.collect = async () => (table === 'messages' ? messages : []);
        return builder;
      },
    };
    return { db };
  }

  test.each([
    ['meal', 'meal'],
    [undefined, 'work'],
    ['corrupt-retired-topic', 'work'],
  ])(
    'returns recorded topic %s as safe policy topic %s without creating a topic',
    async (detail, expected) => {
      expect(query.getConversationPolicyContext).toBeDefined();
      if (!query.getConversationPolicyContext) return;
      await expect(
        query.getConversationPolicyContext._handler(fakeContext(detail), {
          worldId: 'world',
          playerId: 'resident',
          otherPlayerId: 'human',
          conversationId: 'conversation',
        }),
      ).resolves.toMatchObject({ topic: expected });
    },
  );

  test('detects only the actual latest human sea question', async () => {
    expect(query.getConversationPolicyContext).toBeDefined();
    if (!query.getConversationPolicyContext) return;
    const result = await query.getConversationPolicyContext._handler(
      fakeContext('work', '镇上的海在哪里？'),
      {
        worldId: 'world',
        playerId: 'resident',
        otherPlayerId: 'human',
        conversationId: 'conversation',
      },
    );
    expect(result.observerAskedAboutSea).toBe(true);
  });

  test('stores only the rejection enum and content-free identifiers', async () => {
    expect(agentOperations.recordConversationPolicyEvent).toBeDefined();
    if (!agentOperations.recordConversationPolicyEvent) return;
    const inserts: unknown[] = [];
    const args = {
      worldId: 'world',
      playerId: 'resident',
      conversationId: 'conversation',
      reason: 'legacy-story',
      createdAt: 123,
    };
    await agentOperations.recordConversationPolicyEvent._handler(
      { db: { insert: async (_table: string, value: unknown) => void inserts.push(value) } },
      args,
    );
    expect(inserts).toEqual([args]);
    expect(JSON.stringify(inserts)).not.toMatch(/text|output|error|prompt/iu);
  });

  test('schema defines the enum-only policy metric and both time indexes', () => {
    const schema = readFileSync('convex/schema.ts', 'utf8');
    expect(schema).toMatch(/conversationPolicyEvents\s*:\s*defineTable/u);
    expect(schema).toMatch(/world-correction[\s\S]*empty[\s\S]*legacy-story[\s\S]*too-long/u);
    expect(schema).toMatch(
      /\.index\(['"]worldTime['"],\s*\[['"]worldId['"],\s*['"]createdAt['"]\]\)/u,
    );
    expect(schema).toMatch(
      /\.index\(['"]playerTime['"],\s*\[['"]playerId['"],\s*['"]createdAt['"]\]\)/u,
    );
  });
});

describe('daily autonomous memory guard', () => {
  const fallback = {
    'zh-CN': '我记得我们聊了些日常近况。',
    en: 'I remember we talked about everyday life.',
  } as const;

  test.each([
    ['zh-CN', '（微笑） 我们 约好 明天去买菜。 ', '我们 约好 明天去买菜。'],
    [
      'en',
      '[smiles] We agreed to buy groceries tomorrow. ',
      'We agreed to buy groceries tomorrow.',
    ],
    ['zh-CN', '', fallback['zh-CN']],
    ['en', '   ', fallback.en],
    ['zh-CN', '我想起灯塔谜团和海洋异变。', fallback['zh-CN']],
    ['en', 'I diagnosed an unspoken feeling about an ocean anomaly.', fallback.en],
    ['zh-CN', '灯塔镇百万金贝寻宝赛由我获胜。', fallback['zh-CN']],
    ['en', 'I won the Lighthouse Town Million Gold Shell Treasure Hunt.', fallback.en],
  ] as const)(
    'sanitizes %s summary without autonomous forbidden content',
    (locale, raw, expected) => {
      expect(memory.sanitizeMemorySummary).toBeDefined();
      if (!memory.sanitizeMemorySummary) return;
      expect(memory.sanitizeMemorySummary(raw, locale)).toBe(expected);
    },
  );

  test('truncates to 80 grapheme clusters without splitting emoji families', () => {
    expect(memory.sanitizeMemorySummary).toBeDefined();
    if (!memory.sanitizeMemorySummary) return;
    const result = memory.sanitizeMemorySummary(`我${'👨‍👩‍👧‍👦'.repeat(100)}`, 'zh-CN');
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
    const graphemes = Array.from(segmenter.segment(result), ({ segment }) => segment);
    expect(graphemes).toHaveLength(80);
    expect(graphemes.slice(1).every((value) => value === '👨‍👩‍👧‍👦')).toBe(true);
  });

  test('filters reflection inputs without mutation and keeps statement indexes aligned', () => {
    expect(memory.prepareReflectionInput).toBeDefined();
    expect(memory.reflectionRelatedMemoryIds).toBeDefined();
    if (!memory.prepareReflectionInput || !memory.reflectionRelatedMemoryIds) return;
    const ordinary = Object.freeze({
      _id: 'ordinary',
      _creationTime: 3,
      importance: 7,
      description: '我帮邻居买了菜。',
    });
    const legacy = Object.freeze({
      _id: 'legacy',
      _creationTime: 4,
      importance: 900,
      description: '海潮带来异常闪光。',
    });
    const archived = Object.freeze({
      _id: 'archive',
      _creationTime: 5,
      importance: 900,
      description: '我赢得百万金贝寻宝赛。',
    });
    const memories = Object.freeze([ordinary, legacy, archived] as const);

    const prepared = memory.prepareReflectionInput(memories, 0);

    expect(prepared.memories).toEqual([ordinary]);
    expect(prepared.statements).toEqual(['Statement 0: 我帮邻居买了菜。']);
    expect(prepared.sumOfImportanceScore).toBe(7);
    expect(memory.reflectionRelatedMemoryIds(prepared.memories, [0, 1, -1])).toEqual(['ordinary']);
    expect(memories).toEqual([ordinary, legacy, archived]);
  });

  test('uses the locale-aware constrained summary instruction and contains no raw model logging', () => {
    const source = readFileSync('convex/agent/memory.ts', 'utf8');
    expect(source).toContain(
      '用第一人称简体中文，只总结实际谈到的日常生活、承诺、交易、帮助或分歧。控制在 80 个中文字符以内。不要增加海洋、灯塔谜团、异变、心理诊断或未说出口的感情。',
    );
    expect(source).not.toContain('add if you liked or disliked this interaction');
    expect(source).not.toMatch(/console\.debug\(['"]reflection['"],\s*reflection\)/u);
    expect(source).not.toMatch(/Could not parse memory importance from/u);
  });

  test('keeps the historical public archive schema and conversation cap unchanged', () => {
    const schema = readFileSync('convex/schema.ts', 'utf8');
    expect(schema).toMatch(/townEvents\s*:\s*defineTable/u);
    expect(schema).toMatch(/eventLog\s*:\s*defineTable/u);
    expect(MAX_CONVERSATION_MESSAGES).toBe(8);
    expect(MAX_CONVERSATION_MESSAGES).toBeGreaterThanOrEqual(6);
    expect(MAX_CONVERSATION_MESSAGES).toBeLessThanOrEqual(12);
  });
});
