import { buildWerewolfPanelView, type WerewolfPanelState } from './werewolfView';

function humanState(overrides: Partial<WerewolfPanelState> = {}): WerewolfPanelState {
  return {
    sessionId: 'session:1',
    status: 'running',
    mode: 'play',
    phase: 'night-seer',
    round: 1,
    seats: [
      { playerId: 'human:Me', displayName: '你（ME）', seatNumber: 1, alive: true },
      { playerId: 'p:1', displayName: '林澜', seatNumber: 2, alive: true },
    ],
    publicActions: [],
    privateRole: 'seer',
    legalTargets: ['p:1'],
    pendingHumanAction: 'seer-check',
    runoffIds: [],
    viewerId: 'human:Me',
    ...overrides,
  };
}

describe('werewolf panel view', () => {
  test('offers observe and play entry points before a game starts', () => {
    expect(buildWerewolfPanelView(undefined)).toEqual(expect.objectContaining({
      canStart: true,
      startLabels: ['作为观察者开局', '我要加入游戏'],
    }));
  });

  test('human seer sees only their private card and legal targets', () => {
    const view = buildWerewolfPanelView(humanState());
    expect(view.privateCard?.roleLabel).toBe('预言家');
    expect(view.controls).toEqual({ kind: 'target', targets: ['p:1'] });
  });

  test('public observer has no private card or night controls', () => {
    const view = buildWerewolfPanelView(humanState({
      mode: 'observe', viewerId: undefined, privateRole: undefined,
      pendingHumanAction: undefined, legalTargets: [],
    }));
    expect(view.privateCard).toBeUndefined();
    expect(view.controls).toEqual({ kind: 'none' });
    expect(JSON.stringify(view)).not.toContain('witchNoticeTargetId');
  });

  test('formats public speeches and resolved votes as a compact timeline', () => {
    const view = buildWerewolfPanelView(humanState({
      phase: 'day-speaking',
      publicActions: [
        { kind: 'speech', actorId: 'p:1', text: '我先听大家怎么说。', at: 1001 },
        { kind: 'day-vote', actorId: 'p:1', targetId: 'human:Me', at: 1002 },
      ],
    }));
    expect(view.publicTimeline.map((entry) => entry.text)).toEqual([
      '林澜：我先听大家怎么说。',
      '林澜投给了你（ME）',
    ]);
  });
});
