import { readFileSync } from 'node:fs';
import * as conversation from './conversation';
import { TOPIC_DETAILS } from './conversationPolicy';
import type { TopicDetail } from './conversationPolicy';

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
  });
});

describe('Shanghai day key', () => {
  test('changes at 16:00Z, which is midnight in Asia/Shanghai', () => {
    const dayKey = (
      conversation as unknown as { shanghaiDayKey?: (selectedAt: number) => string }
    ).shanghaiDayKey;
    expect(dayKey).toBeDefined();
    if (!dayKey) return;

    expect(dayKey(Date.parse('2026-07-17T15:59:59.999Z'))).toBe('2026-07-17');
    expect(dayKey(Date.parse('2026-07-17T16:00:00.000Z'))).toBe('2026-07-18');
  });
});

describe('daily-life prompt contract', () => {
  test('exports the exact shared simplified-Chinese short-turn rules', () => {
    const rules = (
      conversation as unknown as {
        conversationPromptRules?: (topic: { detail: string }) => string[];
      }
    ).conversationPromptRules;
    expect(rules).toBeDefined();
    if (!rules) return;

    expect(rules({ detail: 'meal' })).toEqual([
      '本轮日常话题：饮食。',
      '用自然的简体中文交谈，每轮只推进一个意思。',
      '普通回复控制在 20–60 个中文字符；开场 15–45 字；告别 10–35 字。',
      '不要使用括号舞台说明，不要长篇描写动作、环境或内心。',
      '不要发起异变、谜团、调查、灯塔机关或海洋话题。',
    ]);
    expect(conversationSource).not.toContain('within 200 characters');
  });

  test('localizes every stable topic detail and safely labels unknown legacy details', () => {
    const rules = conversation.conversationPromptRules;
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
      expect(rules({ detail })[0]).toBe(`本轮日常话题：${expectedLabels[detail]}。`);
    }
    expect(rules({ detail: 'retired-legacy-topic' })[0]).toBe('本轮日常话题：日常近况。');
    expect(rules({ detail: 'toString' })[0]).toBe('本轮日常话题：日常近况。');
  });

  test.each([
    ['startConversationMessage', 'continueConversationMessage'],
    ['continueConversationMessage', 'leaveConversationMessage'],
    ['leaveConversationMessage', undefined],
  ] as const)('%s obtains one persisted topic and adds the shared prompt rules', (name, next) => {
    const source = sourceFor(name, next);
    expect(source).toContain('selfInternal.getOrCreateConversationTopic');
    expect(source).toContain('conversationPromptRules(topic)');
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

  test('bounds every conversation completion to at most 160 tokens', () => {
    const tokenValues = [...conversationSource.matchAll(/max_tokens\s*:\s*(\d+)/gu)].map((match) =>
      Number(match[1]),
    );
    expect(tokenValues).toHaveLength(3);
    expect(tokenValues.every((value) => value <= 160)).toBe(true);
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
      detect(
        { id: 'observer', human: 'observer-user' },
        [{ author: 'observer', text: '那座塔是海上的航标吗？' }],
      ),
    ).toBe(true);
  });

  test.each(['这座塔是用来导航的吗？', 'Is the tower used for navigation?'])(
    'detects a latest human navigation question: %s',
    (text) => {
      expect(detect).toBeDefined();
      if (!detect) return;
      expect(
        detect(
          { id: 'observer', human: 'observer-user' },
          [{ author: 'observer', text }],
        ),
      ).toBe(true);
    },
  );

  test('does not trigger for an AI player or an older observer question', () => {
    expect(detect).toBeDefined();
    if (!detect) return;
    expect(
      detect({ id: 'ai-player' }, [{ author: 'ai-player', text: '镇外有海洋吗？' }]),
    ).toBe(false);
    expect(
      detect(
        { id: 'observer', human: 'observer-user' },
        [
          { author: 'observer', text: '这座塔是用来导航的吗？' },
          { author: 'observer', text: '今天集市几点开？' },
        ],
      ),
    ).toBe(false);
    expect(
      detect(
        { id: 'observer', human: 'observer-user' },
        [{ author: 'resident-ai', text: '这座塔是用来导航的吗？' }],
      ),
    ).toBe(false);
  });

  test('continue and leave use the exact correction, while start does not invent one', () => {
    const correction =
      '观察者问到了海洋设定。先说“镇上没有海，这座塔只是地标。”，再用一句短问句回应。';
    const start = sourceFor('startConversationMessage', 'continueConversationMessage');
    const continuing = sourceFor('continueConversationMessage', 'leaveConversationMessage');
    const leaving = sourceFor('leaveConversationMessage');
    expect(start).not.toContain(correction);
    expect(continuing).toContain(correction);
    expect(leaving).toContain(correction);
  });
});

describe('topic get-or-create contract', () => {
  test('is idempotent per speaker/conversation and balances the resident day', () => {
    expect(conversationSource).toMatch(/export const getOrCreateConversationTopic\s*=\s*internalMutation/u);
    expect(conversationSource).toContain("withIndex('conversation'");
    expect(conversationSource).toContain("withIndex('residentDay'");
    expect(conversationSource).toContain('selectConversationTopic(');
    expect(conversationSource).toContain("ctx.db.insert('conversationTopics'");
  });
});
