import {
  buildVenueActionCue,
  seatAliveForPresentation,
  venueSeatPositions,
} from './werewolfVenueModel';
import type { WerewolfPanelState } from './werewolfView';

describe('werewolf venue model', () => {
  test('nine seats form a stable ellipse and preserve seat order', () => {
    const points = venueSeatPositions(9);
    expect(points).toHaveLength(9);
    expect(points.map((point) => point.seatNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(points.map((point) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`)).size)
      .toBe(9);
  });

  test('god observer sees a wolf target cue without making it public', () => {
    const state: Partial<WerewolfPanelState> = {
      phase: 'night-wolves',
      round: 1,
      observerSecrets: {
        roles: { 'p:0': 'werewolf', 'p:1': 'villager' },
        nightActions: [{
          kind: 'wolf-vote', actorId: 'p:0', targetId: 'p:1', at: 2,
          phase: 'night-wolves', round: 1,
        }],
        pendingNightTargetId: 'p:1',
      },
    };
    expect(buildVenueActionCue(state)).toEqual({
      kind: 'wolf-target', actorIds: ['p:0'], targetId: 'p:1', label: '狼人正在选择目标',
    });
  });

  test('participant receives no secret target cue', () => {
    expect(buildVenueActionCue({ phase: 'night-wolves', round: 1 }))
      .toEqual({ kind: 'sleeping', actorIds: [], label: '夜间行动进行中' });
  });

  test('conceals this round night departure until the presented dawn', () => {
    const seat = {
      alive: false, eliminatedRound: 2, eliminatedBy: 'wolves' as const,
    };
    expect(seatAliveForPresentation(seat, 'night-witch', 2)).toBe(true);
    expect(seatAliveForPresentation(seat, 'dawn', 2)).toBe(false);
    expect(seatAliveForPresentation(seat, 'night-witch', 3)).toBe(false);
  });
});
