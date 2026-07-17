import { readFileSync } from 'node:fs';
import * as conversation from './conversation';
import * as conversationPolicy from './conversationPolicy';
import { TOPIC_DETAILS } from './conversationPolicy';
import type { TopicCategory, TopicDetail } from './conversationPolicy';

const conversationSource = readFileSync('convex/agent/conversation.ts', 'utf8');
const schemaSource = readFileSync('convex/schema.ts', 'utf8');

function sourceFor(name: string, nextName?: string): string {
  const start = conversationSource.indexOf(`export async function ${name}`);
  const end = nextName
    ? conversationSource.indexOf(`export async function ${nextName}`, start)
    : conversationSource.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return conversationSource.slice(start, end);
}

describe('conversation topic schema', () => {
  test('defines auditable topic fields and both lookup indexes', () => {
    expect(schemaSource).toMatch(/conversationTopics\s*:\s*defineTable\s*\(\s*\{/u);
    expect(schemaSource).toMatch(/worldId\s*:\s*v\.id\(['"]worlds['"]\)/u);
    expect(schemaSource).toMatch(/playerId\s*,/u);
    expect(schemaSource).toMatch(/conversationId\s*,/u);
    expect(schemaSource).toMatch(
      /category\s*:\s*v\.union\([\s\S]*?livelihood[\s\S]*?relationship[\s\S]*?public-life[\s\S]*?\)/u,
    );
    expect(schemaSource).toMatch(/detail\s*:\s*v\.string\(\)/u);
    expect(schemaSource).toMatch(/dayKey\s*:\s*v\.string\(\)/u);
    expect(schemaSource).toMatch(/selectedAt\s*:\s*v\.number\(\)/u);
    expect(schemaSource).toMatch(
      /\.index\(['"]conversation['"],\s*\[['"]worldId['"],\s*['"]conversationId['"],\s*['"]playerId['"]\]\)/u,
    );
    expect(schemaSource).toMatch(
      /\.index\(['"]residentDay['"],\s*\[['"]worldId['"],\s*['"]playerId['"],\s*['"]dayKey['"],\s*['"]selectedAt['"]\]\)/u,
    );
    expect(schemaSource).toMatch(
      /\.index\(['"]residentTime['"],\s*\[['"]worldId['"],\s*['"]playerId['"],\s*['"]selectedAt['"]\]\)/u,
    );
  });
});

describe('Shanghai day key', () => {
  test('changes at 16:00Z, which is midnight in Asia/Shanghai', () => {
    const dayKey = (conversation as unknown as { shanghaiDayKey?: (selectedAt: number) => string })
      .shanghaiDayKey;
    expect(dayKey).toBeDefined();
    if (!dayKey) return;

    expect(dayKey(Date.parse('2026-07-17T15:59:59.999Z'))).toBe('2026-07-17');
    expect(dayKey(Date.parse('2026-07-17T16:00:00.000Z'))).toBe('2026-07-18');
  });
});

describe('daily-life prompt contract', () => {
  test('exports the exact shared simplified-Chinese short-turn rules', () => {
    const rules = (
      conversationPolicy as unknown as {
        conversationPromptRules?: (topic: { detail: string }, locale: 'zh-CN' | 'en') => string[];
      }
    ).conversationPromptRules;
    expect(rules).toBeDefined();
    if (!rules) return;

    expect(rules({ detail: 'meal' }, 'zh-CN')).toEqual([
      '本轮日常话题：饮食。',
      '用自然的简体中文交谈，每轮只推进一个意思。',
      '普通回复控制在 20–60 个中文字符；开场 15–45 字；告别 10–35 字。',
      '不要使用括号舞台说明，不要长篇描写动作、环境或内心。',
      '不要发起异变、谜团、调查、灯塔机关或海洋话题。',
    ]);
    expect(conversationSource).not.toContain('within 200 characters');
  });

  test('localizes every stable topic detail and safely labels unknown legacy details', () => {
    const rules = (
      conversationPolicy as unknown as {
        conversationPromptRules?: (topic: { detail: string }, locale: 'zh-CN' | 'en') => string[];
      }
    ).conversationPromptRules;
    expect(rules).toBeDefined();
    if (!rules) return;
    const expectedLabels: Record<TopicDetail, string> = {
      work: '工作',
      order: '订单',
      income: '收入',
      shopping: '采购',
      meal: '饮食',
      clothing: '衣物',
      home: '家务',
      rest: '休息',
      health: '健康',
      friendship: '友情',
      care: '照护',
      date: '约会',
      misunderstanding: '误会',
      cooperation: '合作',
      'neighbor-help': '邻里互助',
      market: '集市',
      class: '课程',
      festival: '节庆',
      institution: '机构服务',
      'local-news': '地方消息',
      safety: '公共安全',
    };
    const policyDetails = Object.values(TOPIC_DETAILS).flat() as TopicDetail[];

    expect(Object.keys(expectedLabels).sort()).toEqual([...policyDetails].sort());
    for (const detail of policyDetails) {
      expect(rules({ detail }, 'zh-CN')[0]).toBe(`本轮日常话题：${expectedLabels[detail]}。`);
    }
    expect(rules({ detail: 'retired-legacy-topic' }, 'zh-CN')[0]).toBe('本轮日常话题：日常近况。');
    expect(rules({ detail: 'toString' }, 'zh-CN')[0]).toBe('本轮日常话题：日常近况。');
  });

  test('renders complete English topic rules and an English-only observer correction', () => {
    const policy = conversationPolicy as unknown as {
      conversationPromptRules?: (topic: { detail: string }, locale: 'zh-CN' | 'en') => string[];
      observerSeaCorrectionInstruction?: (locale: 'zh-CN' | 'en') => string;
    };
    expect(policy.conversationPromptRules).toBeDefined();
    expect(policy.observerSeaCorrectionInstruction).toBeDefined();
    if (!policy.conversationPromptRules || !policy.observerSeaCorrectionInstruction) return;

    const expectedLabels: Record<TopicDetail, string> = {
      work: 'Work',
      order: 'Orders',
      income: 'Income',
      shopping: 'Shopping',
      meal: 'Food',
      clothing: 'Clothing',
      home: 'Housework',
      rest: 'Rest',
      health: 'Health',
      friendship: 'Friendship',
      care: 'Care',
      date: 'Dating',
      misunderstanding: 'Misunderstandings',
      cooperation: 'Cooperation',
      'neighbor-help': 'Neighborly help',
      market: 'Market',
      class: 'Classes',
      festival: 'Festivals',
      institution: 'Public services',
      'local-news': 'Local news',
      safety: 'Public safety',
    };
    const policyDetails = Object.values(TOPIC_DETAILS).flat() as TopicDetail[];
    for (const detail of policyDetails) {
      const rules = policy.conversationPromptRules({ detail }, 'en');
      expect(rules[0]).toBe(`Daily-life topic for this conversation: ${expectedLabels[detail]}.`);
      expect(rules.join('\n')).not.toMatch(/[\u3400-\u9fff]/u);
    }
    expect(policy.conversationPromptRules({ detail: 'legacy' }, 'en')[0]).toBe(
      'Daily-life topic for this conversation: Daily life.',
    );
    const zhCorrection = policy.observerSeaCorrectionInstruction('zh-CN');
    const enCorrection = policy.observerSeaCorrectionInstruction('en');
    expect(zhCorrection).toContain('镇上没有海，这座塔只是地标。');
    expect(zhCorrection).not.toContain('There is no sea');
    expect(enCorrection).toContain('There is no sea in town; this tower is only a landmark.');
    expect(enCorrection).not.toMatch(/[\u3400-\u9fff]/u);
  });

  test.each([
    ['startConversationMessage', 'continueConversationMessage'],
    ['continueConversationMessage', 'leaveConversationMessage'],
    ['leaveConversationMessage', undefined],
  ] as const)('%s obtains one persisted topic and adds the shared prompt rules', (name, next) => {
    const source = sourceFor(name, next);
    expect(source).toContain('selfInternal.getOrCreateConversationTopic');
    expect(source.match(/const locale = getWorldLocale\(\)/gu) ?? []).toHaveLength(1);
    expect(source).toContain('buildWorldPrompt(locale)');
    expect(source).toContain('conversationPromptRules(topic, locale)');
  });

  test.each([
    ['startConversationMessage', 'continueConversationMessage'],
    ['continueConversationMessage', 'leaveConversationMessage'],
    ['leaveConversationMessage', undefined],
  ] as const)('%s filters searched memories before including them in its prompt', (name, next) => {
    const source = sourceFor(name, next);
    const searchAt = source.indexOf('searchMemories');
    const filterAt = source.indexOf('filterLegacyMemories');
    const promptAt = source.indexOf('relatedMemoriesPrompt');
    expect(searchAt).toBeGreaterThanOrEqual(0);
    expect(filterAt).toBeGreaterThan(searchAt);
    expect(promptAt).toBeGreaterThan(filterAt);
  });

  test('filters legacy memories before selecting a prior-conversation memory', () => {
    const source = sourceFor('startConversationMessage', 'continueConversationMessage');
    const filterAt = source.indexOf('filterLegacyMemories');
    const selectionAt = source.indexOf('memoryWithOtherPlayer');
    expect(filterAt).toBeGreaterThanOrEqual(0);
    expect(selectionAt).toBeGreaterThan(filterAt);
  });

  test('uses the exact executable 120-token conversation limit in every completion', () => {
    const maxTokens = (conversation as unknown as { CONVERSATION_MAX_TOKENS?: number })
      .CONVERSATION_MAX_TOKENS;
    expect(maxTokens).toBe(120);
    expect(conversationSource.match(/max_tokens:\s*CONVERSATION_MAX_TOKENS/gu)).toHaveLength(3);
  });
});

describe('cross-day topic selection input', () => {
  test('resets category counts at Shanghai midnight while retaining prior-day details', () => {
    const derive = (
      conversationPolicy as unknown as {
        deriveTopicSelectionInput?: (
          currentDayRows: readonly { category: TopicCategory; detail: string }[],
          recentRows: readonly { category: TopicCategory; detail: string }[],
        ) => { counts: Record<TopicCategory, number>; recent: string[] };
      }
    ).deriveTopicSelectionInput;
    expect(derive).toBeDefined();
    if (!derive) return;

    const midnight = Date.parse('2026-07-17T16:00:00.000Z');
    const rows = [
      { category: 'livelihood' as const, detail: 'work', selectedAt: midnight - 3 },
      { category: 'livelihood' as const, detail: 'order', selectedAt: midnight - 2 },
      { category: 'livelihood' as const, detail: 'income', selectedAt: midnight - 1 },
    ];
    const currentDayRows = rows.filter(
      (row) =>
        conversation.shanghaiDayKey(row.selectedAt) === conversation.shanghaiDayKey(midnight),
    );
    const recentRows = [...rows].sort((a, b) => b.selectedAt - a.selectedAt).slice(0, 3);
    const input = derive(currentDayRows, recentRows);

    expect(input).toEqual({
      counts: { livelihood: 0, relationship: 0, 'public-life': 0 },
      recent: ['income', 'order', 'work'],
    });
    const selected = conversationPolicy.selectConversationTopic(
      'after-midnight',
      input.recent,
      input.counts,
    );
    expect(selected.category).toBe('livelihood');
    expect(input.recent).not.toContain(selected.detail);
  });
});

describe('observer sea-question detection', () => {
  const detect = (
    conversation as unknown as {
      observerAskedAboutSea?: (
        otherPlayer: { id: string; human?: string },
        messages: readonly { author: string; text: string }[],
      ) => boolean;
    }
  ).observerAskedAboutSea;

  test('detects an explicit latest question authored by a human observer', () => {
    expect(detect).toBeDefined();
    if (!detect) return;
    expect(
      detect({ id: 'observer', human: 'observer-user' }, [
        { author: 'observer', text: '那座塔是海上的航标吗？' },
      ]),
    ).toBe(true);
  });

  test.each(['这座塔是用来导航的吗？', 'Is the tower used for navigation?'])(
    'detects a latest human navigation question: %s',
    (text) => {
      expect(detect).toBeDefined();
      if (!detect) return;
      expect(
        detect({ id: 'observer', human: 'observer-user' }, [{ author: 'observer', text }]),
      ).toBe(true);
    },
  );

  test.each([
    '镇上有海吗？',
    '这里没有海吗？',
    '你见过海吗？',
    '这里能看到海吗？',
    '你听过海吗？',
    '海在哪里？',
    '镇上有海吗',
    '这座塔用于导航吗',
  ])('detects a contextual bare-sea or unpunctuated tower question: %s', (text) => {
    expect(detect).toBeDefined();
    if (!detect) return;
    expect(detect({ id: 'observer', human: 'observer-user' }, [{ author: 'observer', text }])).toBe(
      true,
    );
  });

  test.each([
    '海鲜市场几点开？',
    '今天吃海鲜吗？',
    '这张海报是谁画的？',
    '这张海报多少钱？',
    '海棠花什么时候开？',
    '海棠开了吗？',
    '市场有海带吗？',
    '店里有海盐吗？',
    '机构有海外订单吗？',
    '码头有海运服务吗？',
    '仓库有海量库存吗？',
    '手机导航怎么设置？',
    'GPS导航准吗？',
    '地图导航好用吗？',
    'Does this software beacon work?',
    'Is web navigation accessible?',
    'Do you like the sea? Then what time is the market',
  ])(
    'does not treat unrelated or non-final question syntax as a sea-setting question: %s',
    (text) => {
      expect(detect).toBeDefined();
      if (!detect) return;
      expect(
        detect({ id: 'observer', human: 'observer-user' }, [{ author: 'observer', text }]),
      ).toBe(false);
    },
  );

  test.each([
    '镇外有海洋吗？',
    '这里能看到海上日落吗？',
    '附近有大海或海边吗？',
    '海岸会有海潮吗？',
    '潮汐适合观潮吗？',
    '那是航标吗？',
    '高塔可以航行定位吗？',
    'Is there an ocean coast nearby?',
    'Is the lighthouse used as a beacon?',
    'Is that a sea beacon?”  ',
  ])('detects explicit final marine or tower-navigation questions: %s', (text) => {
    expect(detect).toBeDefined();
    if (!detect) return;
    expect(detect({ id: 'observer', human: 'observer-user' }, [{ author: 'observer', text }])).toBe(
      true,
    );
  });

  test('does not trigger for an AI player or an older observer question', () => {
    expect(detect).toBeDefined();
    if (!detect) return;
    expect(detect({ id: 'ai-player' }, [{ author: 'ai-player', text: '镇外有海洋吗？' }])).toBe(
      false,
    );
    expect(
      detect({ id: 'observer', human: 'observer-user' }, [
        { author: 'observer', text: '这座塔是用来导航的吗？' },
        { author: 'observer', text: '今天集市几点开？' },
      ]),
    ).toBe(false);
    expect(
      detect({ id: 'observer', human: 'observer-user' }, [
        { author: 'resident-ai', text: '这座塔是用来导航的吗？' },
      ]),
    ).toBe(false);
  });

  test('continue and leave use the locale correction helper, while start does not invent one', () => {
    const start = sourceFor('startConversationMessage', 'continueConversationMessage');
    const continuing = sourceFor('continueConversationMessage', 'leaveConversationMessage');
    const leaving = sourceFor('leaveConversationMessage');
    expect(start).not.toContain('observerSeaCorrectionInstruction(locale)');
    expect(continuing).toContain('observerSeaCorrectionInstruction(locale)');
    expect(leaving).toContain('observerSeaCorrectionInstruction(locale)');
  });
});

describe('topic get-or-create contract', () => {
  test('is idempotent per speaker/conversation and balances the resident day', () => {
    expect(conversationSource).toMatch(
      /export const getOrCreateConversationTopic\s*=\s*internalMutation/u,
    );
    expect(conversationSource).toContain("withIndex('conversation'");
    expect(conversationSource).toContain("withIndex('residentDay'");
    expect(conversationSource).toContain("withIndex('residentTime'");
    expect(conversationSource).toContain(".order('desc')");
    expect(conversationSource).toContain('.take(3)');
    expect(conversationSource).toContain('selectConversationTopic(');
    expect(conversationSource).toContain("ctx.db.insert('conversationTopics'");
  });

  type TopicRecord = {
    worldId: string;
    playerId: string;
    conversationId: string;
    category: TopicCategory;
    detail: string;
    dayKey: string;
    selectedAt: number;
  };

  function fakeTopicContext(options: {
    existing?: TopicRecord;
    currentDay?: TopicRecord[];
    recent?: TopicRecord[];
    shared?: TopicRecord[];
  }) {
    const indexes: string[] = [];
    const inserts: TopicRecord[] = [];
    const records = [
      ...(options.existing ? [options.existing] : []),
      ...(options.shared ?? []),
      ...(options.currentDay ?? []),
      ...(options.recent ?? []),
    ];
    const db = {
      query: (_table: string) => {
        const equalities: Record<string, string> = {};
        const builder: Record<string, unknown> = {};
        const chain: { eq: (field: string, value: string) => typeof chain } = {
          eq: (field, value) => {
            equalities[field] = value;
            return chain;
          },
        };
        builder.withIndex = (name: string, apply: (q: typeof chain) => unknown) => {
          indexes.push(name);
          apply(chain);
          return builder;
        };
        const matches = (record: TopicRecord) =>
          Object.entries(equalities).every(
            ([field, value]) => record[field as keyof TopicRecord] === value,
          );
        builder.unique = async () => records.find(matches) ?? null;
        builder.order = () => builder;
        builder.take = async (limit: number) =>
          records
            .filter(matches)
            .sort((a, b) => b.selectedAt - a.selectedAt)
            .slice(0, limit);
        builder.collect = async () =>
          records.filter(matches).sort((a, b) => a.selectedAt - b.selectedAt);
        return builder;
      },
      insert: async (_table: string, record: TopicRecord) => {
        inserts.push(record);
        records.push(record);
        return 'topic-id';
      },
    };
    return { ctx: { db }, indexes, inserts };
  }

  const registeredMutation =
    conversation.getOrCreateConversationTopic as typeof conversation.getOrCreateConversationTopic & {
      _handler: (
        ctx: unknown,
        args: { worldId: string; playerId: string; conversationId: string; now: number },
      ) => Promise<TopicRecord>;
    };

  test('registered mutation returns an existing speaker topic without inserting', async () => {
    const existing: TopicRecord = {
      worldId: 'world',
      playerId: 'speaker',
      conversationId: 'conversation',
      category: 'relationship',
      detail: 'care',
      dayKey: '2026-07-18',
      selectedAt: 10,
    };
    const fake = fakeTopicContext({ existing });

    const args = {
      worldId: 'world',
      playerId: 'speaker',
      conversationId: 'conversation',
      now: 20,
    };
    await expect(registeredMutation._handler(fake.ctx, args)).resolves.toBe(existing);
    await expect(registeredMutation._handler(fake.ctx, args)).resolves.toBe(existing);
    expect(fake.inserts).toHaveLength(0);
    expect(fake.indexes).toEqual(['conversation', 'conversation']);
  });

  test('registered mutation reuses a shared conversation topic and inserts exactly once', async () => {
    const shared: TopicRecord = {
      worldId: 'world',
      playerId: 'first-speaker',
      conversationId: 'conversation',
      category: 'public-life',
      detail: 'market',
      dayKey: '2026-07-17',
      selectedAt: 10,
    };
    const fake = fakeTopicContext({ shared: [shared] });

    const args = {
      worldId: 'world',
      playerId: 'new-speaker',
      conversationId: 'conversation',
      now: Date.parse('2026-07-17T16:00:00.000Z'),
    };
    const result = await registeredMutation._handler(fake.ctx, args);
    const repeated = await registeredMutation._handler(fake.ctx, args);

    expect(result).toMatchObject({ category: 'public-life', detail: 'market' });
    expect(repeated).toBe(result);
    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0]).toMatchObject({ category: 'public-life', detail: 'market' });
    expect(fake.indexes).toEqual([
      'conversation',
      'residentDay',
      'residentTime',
      'conversation',
      'conversation',
    ]);
  });
});
