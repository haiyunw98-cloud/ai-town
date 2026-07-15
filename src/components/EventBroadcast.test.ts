import {
  buildDailyReport,
  buildBroadcastView,
  buildTownStory,
  type BroadcastSnapshot,
} from './eventBroadcastView';

const running: BroadcastSnapshot = {
  event: {
    id: 'event-1',
    name: '灯塔镇百万金贝寻宝赛',
    status: 'running',
    phase: 'treasureHunt',
    phaseEndsAt: 70_000,
    prize: '一百万金贝',
  },
  participants: [
    {
      residentId: 'p:1',
      displayName: '顾潮',
      score: 88,
      shells: 3,
      active: true,
      role: 'competitor',
      rank: 1,
      quote: '灯火照路，我先走一步！',
    },
  ],
  logs: [],
  conversations: [],
  residentActivity: [],
};

describe('event broadcast view model', () => {
  test('uses town chronicle mode before an event exists', () => {
    const view = buildBroadcastView(
      { event: null, participants: [], logs: [], conversations: [], residentActivity: [] },
      'zh-CN',
      10_000,
    );
    expect(view.mode).toBe('chronicle');
    expect(view.title).toBe('灯塔镇镇志');
  });

  test('turns grouped resident dialogue into an observer-friendly town story', () => {
    const story = buildTownStory([
      {
        conversationId: 'c:1',
        participantNames: ['白露', '墨七'],
        summary: '白露与墨七正在追查河道异常，并担心野花枯萎。',
        updatedAt: 12_000,
        messages: [
          { authorName: '墨七', text: '这些野花恐怕撑不了几个昼夜。', createdAt: 11_000 },
        ],
      },
      {
        conversationId: 'c:2',
        participantNames: ['唐果', '顾潮'],
        summary: '唐果提醒顾潮小心灯塔下方的机关。',
        updatedAt: 10_000,
        messages: [],
      },
    ]);

    expect(story.headline).toContain('小镇异变');
    expect(story.bullets).toHaveLength(2);
    expect(story.bullets[0]).toContain('白露');
  });

  test('formats a running phase and countdown for observers', () => {
    const view = buildBroadcastView(running, 'zh-CN', 10_000);
    expect(view.mode).toBe('event');
    expect(view.phaseLabel).toBe('八人寻宝冲刺');
    expect(view.countdown).toBe('01:00');
    expect(view.activeCount).toBe(1);
  });

  test('shows the winner after awards', () => {
    const completed: BroadcastSnapshot = {
      ...running,
      event: { ...running.event!, status: 'completed', phase: 'awards', winnerId: 'p:1' },
    };
    const view = buildBroadcastView(completed, 'zh-CN', 80_000);
    expect(view.phaseLabel).toBe('百万金贝颁奖礼');
    expect(view.winnerName).toBe('顾潮');
  });

  test('exports an observer daily report with activity, growth, relationships, and dialogue', () => {
    const report = buildDailyReport(
      {
        ...running,
        residentActivity: [
          { residentId: 'p:1', displayName: '顾潮', status: '生活中', detail: '在苏氏机关坊制作船灯' },
        ],
        dailyLifeEvents: [
          { residentId: 'p:1', displayName: '顾潮', kind: 'work', text: '在苏氏机关坊：完成抗风船灯', createdAt: 20_000 },
        ],
        conversations: [
          {
            conversationId: 'c:1',
            participantNames: ['顾潮', '苏萤'],
            summary: '顾潮与苏萤商量了船灯订单。',
            updatedAt: 21_000,
            messages: [{ authorName: '顾潮', text: '今晚试灯。', createdAt: 21_000 }],
          },
        ],
      },
      'zh-CN',
      new Date(1970, 0, 1, 12).getTime(),
    );
    expect(report).toContain('# 灯塔镇观察者日报');
    expect(report).toContain('## 居民活动与发展');
    expect(report).toContain('在苏氏机关坊：完成抗风船灯');
    expect(report).toContain('当前目标');
    expect(report).toContain('关系进展');
    expect(report).toContain('## 重要对话');
    expect(report).toContain('顾潮 × 苏萤');
  });
});
