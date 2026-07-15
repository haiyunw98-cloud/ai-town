import { buildBroadcastView, BroadcastSnapshot } from './eventBroadcastView';

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
};

describe('event broadcast view model', () => {
  test('uses town chronicle mode before an event exists', () => {
    const view = buildBroadcastView({ event: null, participants: [], logs: [] }, 'zh-CN', 10_000);
    expect(view.mode).toBe('chronicle');
    expect(view.title).toBe('灯塔镇镇志');
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
});
