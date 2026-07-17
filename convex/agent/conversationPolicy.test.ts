import {
  containsLegacyStory,
  filterLegacyMemories,
  selectConversationTopic,
  TOPIC_DETAILS,
  validateResidentReply,
} from './conversationPolicy';
import type { ReplyContext, TopicCategory, TopicDetail } from './conversationPolicy';
import * as conversationPolicy from './conversationPolicy';

const length = (value: string) => Array.from(value).length;

const topicDetails = Object.values(TOPIC_DETAILS).flat() as TopicDetail[];

describe('selectConversationTopic', () => {
  test('allocates the exact rolling 60/25/15 category budget over 100 choices', () => {
    const counts: Record<TopicCategory, number> = {
      livelihood: 0,
      relationship: 0,
      'public-life': 0,
    };
    const recent: string[] = [];

    for (let index = 0; index < 100; index += 1) {
      const topic = selectConversationTopic(`day-${index}`, recent, counts);
      counts[topic.category] += 1;
      recent.push(topic.detail);
    }

    expect(counts).toEqual({ livelihood: 60, relationship: 25, 'public-life': 15 });
  });

  test('does not repeat any of the last three details when alternatives exist', () => {
    const counts: Record<TopicCategory, number> = {
      livelihood: 0,
      relationship: 0,
      'public-life': 0,
    };
    const recent: string[] = [];

    for (let index = 0; index < 100; index += 1) {
      const topic = selectConversationTopic('same-seed', recent, counts);
      expect(recent.slice(-3)).not.toContain(topic.detail);
      counts[topic.category] += 1;
      recent.push(topic.detail);
    }
  });

  test('returns the same topic for the same inputs', () => {
    const counts: Record<TopicCategory, number> = {
      livelihood: 12,
      relationship: 5,
      'public-life': 3,
    };
    const recent: readonly string[] = Object.freeze(['work', 'friendship', 'market']);

    expect(selectConversationTopic('2026-07-17:resident-4', recent, counts)).toEqual(
      selectConversationTopic('2026-07-17:resident-4', recent, counts),
    );
  });

  test('keeps every zero-based prefix within one choice of its target allocation', () => {
    const targets: Record<TopicCategory, number> = {
      livelihood: 0.6,
      relationship: 0.25,
      'public-life': 0.15,
    };
    const counts: Record<TopicCategory, number> = {
      livelihood: 0,
      relationship: 0,
      'public-life': 0,
    };

    for (let index = 0; index < 200; index += 1) {
      const topic = selectConversationTopic(`prefix-${index}`, [], counts);
      counts[topic.category] += 1;
      const total = index + 1;
      for (const category of Object.keys(counts) as TopicCategory[]) {
        expect(Math.abs(counts[category] - targets[category] * total)).toBeLessThanOrEqual(1);
      }
    }
  });

  test.each([
    { livelihood: 17, relationship: 2, 'public-life': 1 },
    { livelihood: 1, relationship: 17, 'public-life': 2 },
    { livelihood: 2, relationship: 1, 'public-life': 17 },
  ])('recovers the target allocation from arbitrary valid counts %#', (startingCounts) => {
    const counts: Record<TopicCategory, number> = { ...startingCounts };

    for (let index = 0; index < 300; index += 1) {
      const topic = selectConversationTopic(`recovery-${index}`, [], counts);
      counts[topic.category] += 1;
    }

    expect(counts).toEqual({ livelihood: 192, relationship: 80, 'public-life': 48 });
  });
});

describe('legacy story isolation', () => {
  test.each([
    '百万金贝大奖',
    '一百万金贝寻宝比赛',
    '往届寻宝竞赛冠军',
    'million-shell treasure contest',
    'million golden shells prize',
    'previous treasure hunt champion',
  ])('filters archived public event variant %s from autonomous memories', (variant) => {
    const containsArchivedEventMemory = (
      conversationPolicy as unknown as {
        containsArchivedEventMemory?: (value: string) => boolean;
      }
    ).containsArchivedEventMemory;
    const archived = { description: `居民记得 ${variant}。` };

    expect(containsArchivedEventMemory).toBeDefined();
    if (!containsArchivedEventMemory) return;
    expect(containsArchivedEventMemory(archived.description)).toBe(true);
    expect(filterLegacyMemories([archived])).toEqual([]);
  });

  const legacyTerms = [
    '海面',
    '海潮',
    '潮汐',
    '观潮',
    '航标',
    '海风',
    '海浪',
    '夜航',
    '失落航路',
    '无海航路',
    '异常闪光',
    '灯塔谜',
    '机关谜',
    '线索交汇',
    '雾潮',
    '灯塔导航',
    'sea beacon',
    'sea navigation',
    'lighthouse navigation',
  ];

  test.each(legacyTerms)('identifies legacy content containing %s', (term) => {
    expect(containsLegacyStory(`居民又提起了${term}的传闻。`)).toBe(true);
  });

  test.each(['ocean tide', 'ocean beacon', 'ocean navigation', 'lighthouse mystery', 'anomaly'])(
    'rejects the exact English legacy phrase %s',
    (phrase) => {
      expect(containsLegacyStory(`A resident repeated the ${phrase} story.`)).toBe(true);
      expect(
        validateResidentReply(`A resident repeated the ${phrase} story.`, {
          kind: 'continue',
          topic: 'local-news',
          observerAskedAboutSea: false,
        }),
      ).toMatchObject({ accepted: false, reason: 'legacy-story' });
    },
  );

  test.each(['运河', '河道', '码头', '乌篷船', '摆渡'])(
    'allows ordinary inland content containing %s',
    (term) => {
      expect(containsLegacyStory(`居民在${term}边忙了一上午。`)).toBe(false);
    },
  );

  test.each(['river', 'canal', 'dock', 'ferry'])(
    'allows ordinary inland English content containing %s',
    (term) => {
      expect(containsLegacyStory(`Residents finished their work beside the ${term}.`)).toBe(false);
    },
  );

  test('filters matching memories without mutation and preserves order and identity', () => {
    const first = Object.freeze({ description: '我在市场买了青菜。', id: 1 });
    const legacy = Object.freeze({ description: '昨夜海潮带来了异常闪光。', id: 2 });
    const third = Object.freeze({ description: '我帮邻居修好了门锁。', id: 3 });
    const memories = Object.freeze([first, legacy, third] as const);

    const filtered = filterLegacyMemories(memories);

    expect(filtered).toEqual([first, third]);
    expect(filtered[0]).toBe(first);
    expect(filtered[1]).toBe(third);
    expect(memories).toEqual([first, legacy, third]);
    expect(filtered).not.toBe(memories);
  });

  test.each(['灯塔导航', 'lighthouse navigation'])(
    'rejects %s through predicate, memory filter, and reply validation',
    (term) => {
      const legacy = { description: `居民提起了${term}。` };
      const ordinary = { description: '居民在运河边摆渡。' };

      expect(containsLegacyStory(legacy.description)).toBe(true);
      expect(filterLegacyMemories([ordinary, legacy])).toEqual([ordinary]);
      expect(
        validateResidentReply(legacy.description, {
          kind: 'continue',
          topic: 'local-news',
          observerAskedAboutSea: false,
        }),
      ).toMatchObject({ accepted: false, reason: 'legacy-story' });
    },
  );
});

describe('validateResidentReply', () => {
  test.each([
    ['zh-CN', '我赢得了百万金贝大奖。'],
    ['zh-CN', '我们聊起海洋里的新异变。'],
    ['en', 'I won the million golden shells prize.'],
    ['en', 'We discussed an ocean anomaly.'],
  ] as const)('rejects forbidden autonomous memory at the final boundary in %s', (locale, raw) => {
    const result = validateResidentReply(raw, {
      kind: 'continue',
      topic: 'work',
      observerAskedAboutSea: false,
      locale,
    });

    expect(result).toMatchObject({ accepted: false, reason: 'legacy-story' });
    expect(result.text).not.toBe(raw);
  });

  test.each([
    ['zh-CN', '我在运河边帮邻居搬货。'],
    ['en', 'I helped a neighbor by the canal.'],
  ] as const)('preserves valid inland daily talk in %s', (locale, raw) => {
    expect(
      validateResidentReply(raw, {
        kind: 'continue',
        topic: 'neighbor-help',
        observerAskedAboutSea: false,
        locale,
      }),
    ).toEqual({ accepted: true, text: raw });
  });

  test('uses English punctuation when naturally trimming an English reply', () => {
    const result = validateResidentReply(
      'Today I need to sort orders and check every shelf and update the account book '.repeat(3),
      {
        kind: 'leave',
        topic: 'work',
        observerAskedAboutSea: false,
        locale: 'en',
      },
    );

    expect(result).toMatchObject({ accepted: false, reason: 'too-long' });
    expect(result.text).toMatch(/\.$/u);
    expect(result.text).not.toContain('。');
    expect(length(result.text)).toBeLessThanOrEqual(35);
  });

  test('always corrects an observer sea question with the exact prefix and a short question', () => {
    const result = validateResidentReply('海上昨晚确实有灯光。', {
      kind: 'continue',
      topic: 'local-news',
      observerAskedAboutSea: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('world-correction');
    expect(result.text.startsWith('镇上没有海，这座塔只是地标。')).toBe(true);
    expect(result.text.endsWith('？')).toBe(true);
    expect(length(result.text)).toBeLessThanOrEqual(60);
  });

  test('removes ASCII and full-width parenthesized stage directions and collapses whitespace', () => {
    const result = validateResidentReply('（笑着挥手）  今天  生意不错。 (看向门外) 你呢？', {
      kind: 'continue',
      topic: 'work',
      observerAskedAboutSea: false,
    });

    expect(result).toEqual({ accepted: true, text: '今天 生意不错。 你呢？' });
  });

  test.each([
    '（叹气）。今天茶庄新到了一批龙井，要不要一起尝尝？',
    '(叹气). 今天茶庄新到了一批龙井，要不要一起尝尝？',
  ])('discards punctuation-only fragments left by stage directions: %s', (raw) => {
    const result = validateResidentReply(raw, {
      kind: 'continue',
      topic: 'shopping',
      observerAskedAboutSea: false,
    });

    expect(result).toEqual({
      accepted: true,
      text: '今天茶庄新到了一批龙井，要不要一起尝尝？',
    });
    expect(result.text).not.toMatch(/^\p{P}/u);
    expect(length(result.text)).toBeLessThanOrEqual(60);
  });

  test('removes nested mixed-width directions and unmatched parenthesis residue', () => {
    const result = validateResidentReply('“（低声(叹气)）今天茶庄）新到了一批龙井，要尝尝吗？”', {
      kind: 'continue',
      topic: 'shopping',
      observerAskedAboutSea: false,
    });

    expect(result).toEqual({
      accepted: true,
      text: '“今天茶庄新到了一批龙井，要尝尝吗？”',
    });
  });

  test.each([
    '“今天茶庄新到了一批龙井，要不要一起尝尝？”',
    '"Today the tea shop received fresh tea. Want to try it?"',
  ])('preserves a reply enclosed by matching quotes: %s', (raw) => {
    expect(
      validateResidentReply(raw, {
        kind: 'continue',
        topic: 'shopping',
        observerAskedAboutSea: false,
      }).text,
    ).toBe(raw);
  });

  test.each(['“（沉默(低头)）”', '...', '。。。', '“”', '""'])(
    'treats sanitized punctuation-only content as empty: %s',
    (raw) => {
      const context = {
        kind: 'continue',
        topic: 'market',
        observerAskedAboutSea: false,
      } as const;

      expect(validateResidentReply(raw, context)).toEqual(validateResidentReply('', context));
    },
  );

  test.each(['🙂', '“🙂”'])('keeps meaningful emoji content: %s', (raw) => {
    expect(
      validateResidentReply(raw, {
        kind: 'continue',
        topic: 'market',
        observerAskedAboutSea: false,
      }),
    ).toEqual({ accepted: true, text: raw });
  });

  test.each([
    [`“今天先整理订单。${'接下来还要核对货架和账本，'.repeat(6)}”`, '今天先整理订单。'],
    [
      `"Today I will sort orders first. ${'Then I will check every shelf and account, '.repeat(5)}"`,
      'Today I will sort orders first.',
    ],
    [
      `“（认真(点头)）今天先整理订单。${'接下来还要核对货架和账本，'.repeat(6)}”`,
      '今天先整理订单。',
    ],
  ])('does not return an unmatched opening quote when shortening %s', (raw, expected) => {
    const result = validateResidentReply(raw, {
      kind: 'continue',
      topic: 'order',
      observerAskedAboutSea: false,
    });

    expect(result).toEqual({ accepted: false, text: expected, reason: 'too-long' });
    expect(length(result.text)).toBeLessThanOrEqual(60);
  });

  test('returns a deterministic ordinary fallback for an empty reply', () => {
    const context = {
      kind: 'start',
      topic: 'meal',
      observerAskedAboutSea: false,
    } satisfies ReplyContext;

    const first = validateResidentReply('（沉默）   ', context);
    const second = validateResidentReply('（沉默）   ', context);

    expect(first).toEqual(second);
    expect(first.accepted).toBe(false);
    expect(first.reason).toBe('empty');
    expect(first.text).not.toBe('');
    expect(containsLegacyStory(first.text)).toBe(false);
    expect(length(first.text)).toBeLessThanOrEqual(45);
  });

  test('replaces a legacy story with a deterministic ordinary-life fallback', () => {
    const context = {
      kind: 'continue',
      topic: 'neighbor-help',
      observerAskedAboutSea: false,
    } satisfies ReplyContext;

    const first = validateResidentReply('我昨晚在海面发现异常闪光，像是灯塔谜的线索。', context);
    const second = validateResidentReply('我昨晚在海面发现异常闪光，像是灯塔谜的线索。', context);

    expect(first).toEqual(second);
    expect(first.accepted).toBe(false);
    expect(first.reason).toBe('legacy-story');
    expect(containsLegacyStory(first.text)).toBe(false);
    expect(length(first.text)).toBeLessThanOrEqual(60);
  });

  test('uses distinct deterministic safe fallbacks for date, health, and market topics', () => {
    const topics = ['date', 'health', 'market'] as const;
    const emptyReplies = topics.map(
      (topic) =>
        validateResidentReply('', {
          kind: 'continue',
          topic,
          observerAskedAboutSea: false,
        }).text,
    );
    const legacyReplies = topics.map(
      (topic) =>
        validateResidentReply('海潮带来了异常闪光。', {
          kind: 'continue',
          topic,
          observerAskedAboutSea: false,
        }).text,
    );

    expect(new Set(emptyReplies).size).toBe(topics.length);
    expect(new Set(legacyReplies).size).toBe(topics.length);
  });

  test('keeps every topic fallback ordinary and within every reply-kind bound', () => {
    const limits = { start: 45, continue: 60, leave: 35 } as const;

    for (const topic of topicDetails) {
      for (const kind of Object.keys(limits) as Array<keyof typeof limits>) {
        for (const [raw, reason] of [
          ['', 'empty'],
          ['海潮带来了异常闪光。', 'legacy-story'],
        ] as const) {
          const result = validateResidentReply(raw, {
            kind,
            topic,
            observerAskedAboutSea: false,
          });
          expect(result).toMatchObject({ accepted: false, reason });
          expect(result.text).not.toBe('');
          expect(containsLegacyStory(result.text)).toBe(false);
          expect(length(result.text)).toBeLessThanOrEqual(limits[kind]);
        }
      }
    }
  });

  test.each([
    ['start', 45],
    ['continue', 60],
    ['leave', 35],
  ] as const)('enforces the %s reply bound of %i Unicode code points', (kind, limit) => {
    const result = validateResidentReply(`今天${'🙂'.repeat(80)}我们晚点再聊`, {
      kind,
      topic: 'rest',
      observerAskedAboutSea: false,
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('too-long');
    expect(length(result.text)).toBeLessThanOrEqual(limit);
    expect(result.text).not.toContain('\uFFFD');
    expect(result.text).toMatch(/[。！？.!?]$/u);
  });

  test('prefers the first complete sentence when shortening a long reply', () => {
    const result = validateResidentReply(
      `今天先把店里的订单整理好。${'然后再和邻居商量周末怎么一起收拾院子，'.repeat(4)}`,
      { kind: 'start', topic: 'order', observerAskedAboutSea: false },
    );

    expect(result).toEqual({
      accepted: false,
      text: '今天先把店里的订单整理好。',
      reason: 'too-long',
    });
  });

  test('does not mistake a decimal point for a sentence boundary', () => {
    const result = validateResidentReply(
      `今天收入是3.5元，账本已经核对好了。${'接下来还要整理订单和货架，'.repeat(5)}`,
      { kind: 'start', topic: 'income', observerAskedAboutSea: false },
    );

    expect(result).toEqual({
      accepted: false,
      text: '今天收入是3.5元，账本已经核对好了。',
      reason: 'too-long',
    });
  });

  test('treats consecutive periods as an ellipsis rather than a sentence boundary', () => {
    const result = validateResidentReply(
      `我想想...还是先把账本理清楚。${'接下来还要整理订单和货架，'.repeat(5)}`,
      { kind: 'start', topic: 'income', observerAskedAboutSea: false },
    );

    expect(result).toEqual({
      accepted: false,
      text: '我想想...还是先把账本理清楚。',
      reason: 'too-long',
    });
  });

  test('does not mistake a leading decimal point for a sentence boundary', () => {
    const result = validateResidentReply(
      `今天米价涨了.5元，账本已经记好。${'接下来还要整理订单和货架，'.repeat(5)}`,
      { kind: 'start', topic: 'income', observerAskedAboutSea: false },
    );

    expect(result).toEqual({
      accepted: false,
      text: '今天米价涨了.5元，账本已经记好。',
      reason: 'too-long',
    });
  });

  test.each([
    [
      `Dr. Chen checked today's order list. ${'The rest of the stock still needs counting, '.repeat(4)}`,
      "Dr. Chen checked today's order list.",
    ],
    [
      `The U.S. market opens today. ${'The rest of the stock still needs counting, '.repeat(4)}`,
      'The U.S. market opens today.',
    ],
  ])('does not mistake a common short abbreviation for a sentence boundary', (raw, expected) => {
    const result = validateResidentReply(raw, {
      kind: 'start',
      topic: 'order',
      observerAskedAboutSea: false,
    });

    expect(result).toEqual({
      accepted: false,
      text: expected,
      reason: 'too-long',
    });
  });

  test.each(['👨‍👩‍👧‍👦', 'e\u0301', '✈️', '🇨🇳'])(
    'truncates without splitting the %s grapheme cluster',
    (cluster) => {
      const result = validateResidentReply(`今${cluster.repeat(80)}稍后再聊`, {
        kind: 'leave',
        topic: 'rest',
        observerAskedAboutSea: false,
      });
      const retainedClusters = result.text.slice(1, -1);

      expect(result).toMatchObject({ accepted: false, reason: 'too-long' });
      expect(length(result.text)).toBeLessThanOrEqual(35);
      expect(retainedClusters).not.toBe('');
      expect(retainedClusters.replaceAll(cluster, '')).toBe('');
      expect(result.text.endsWith('。')).toBe(true);
    },
  );

  test('pairs regional indicators in the deterministic no-Intl grapheme fallback', () => {
    const internal = conversationPolicy as unknown as {
      segmentConversationGraphemes: (value: string, segmenter: null) => string[];
    };
    const flag = '🇨🇳';

    expect(internal.segmentConversationGraphemes(flag.repeat(3), null)).toEqual([flag, flag, flag]);
  });

  test('does not leave a comma, colon, or semicolon at a trimmed boundary', () => {
    const result = validateResidentReply(
      '今天要做的事很多，先理货，再记账，然后去买菜，晚上还要整理房间'.repeat(3),
      {
        kind: 'leave',
        topic: 'work',
        observerAskedAboutSea: false,
      },
    );

    expect(result.text).not.toMatch(/[，,：:；;]$/u);
    expect(length(result.text)).toBeLessThanOrEqual(35);
  });
});
