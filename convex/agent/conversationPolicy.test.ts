import {
  containsLegacyStory,
  filterLegacyMemories,
  selectConversationTopic,
  TopicCategory,
  validateResidentReply,
} from './conversationPolicy';

const length = (value: string) => Array.from(value).length;

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
    const recent = ['work', 'friendship', 'market'];

    expect(selectConversationTopic('2026-07-17:resident-4', recent, counts)).toEqual(
      selectConversationTopic('2026-07-17:resident-4', recent, counts),
    );
  });
});

describe('legacy story isolation', () => {
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
    'ocean tide',
    'sea beacon',
    'sea navigation',
    'lighthouse mystery',
    'anomaly',
  ];

  test.each(legacyTerms)('identifies legacy content containing %s', (term) => {
    expect(containsLegacyStory(`居民又提起了${term}的传闻。`)).toBe(true);
  });

  test.each(['运河', '河道', '码头', '乌篷船', '摆渡'])(
    'allows ordinary inland content containing %s',
    (term) => {
      expect(containsLegacyStory(`居民在${term}边忙了一上午。`)).toBe(false);
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
});

describe('validateResidentReply', () => {
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

  test('returns a deterministic ordinary fallback for an empty reply', () => {
    const context = { kind: 'start' as const, topic: 'meal', observerAskedAboutSea: false };

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
      kind: 'continue' as const,
      topic: 'neighbor-help',
      observerAskedAboutSea: false,
    };

    const first = validateResidentReply('我昨晚在海面发现异常闪光，像是灯塔谜的线索。', context);
    const second = validateResidentReply('我昨晚在海面发现异常闪光，像是灯塔谜的线索。', context);

    expect(first).toEqual(second);
    expect(first.accepted).toBe(false);
    expect(first.reason).toBe('legacy-story');
    expect(containsLegacyStory(first.text)).toBe(false);
    expect(length(first.text)).toBeLessThanOrEqual(60);
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
