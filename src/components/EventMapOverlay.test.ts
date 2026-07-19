import { buildEventOverlayState, type EventMapSnapshot } from './eventMapOverlayModel';
import {
  mapheight,
  mapwidth,
  objmap,
  trialIslandCheckpoints,
} from '../../data/worlds/lighthouse-town/map';

function snapshot(stageIndex: number, winnerId?: string): NonNullable<EventMapSnapshot> {
  return {
    event: {
      dailyKey: '2026-07-19',
      name: '试炼岛安全协作赛',
      status: winnerId ? 'completed' : 'running',
      phase: winnerId ? 'awards' : 'round-one',
      stageIndex,
      templateId: 'safe-survival',
      venueMode: 'trial-island',
      winnerId,
    },
    participants: Array.from({ length: 9 }, (_, index) => ({
      residentId: `p:${index}`,
      displayName: `居民${index}`,
      active: index < 4,
      role: index < 4 ? 'competitor' : 'spectator',
      teamId: index < 4 ? `team-${index % 2}` : undefined,
      rank: index === 0 ? 1 : undefined,
    })),
  };
}

describe('Trial Island live map overlay', () => {
  test('maps the current stage to the visible facility and shows teams and spectators', () => {
    const state = buildEventOverlayState(snapshot(1));
    expect(state.isIslandEvent).toBe(true);
    expect(state.stage?.label).toBe('按令前进赛道');
    expect(state.activeCheckpoint).toEqual(trialIslandCheckpoints.track);
    expect(state.teamCount).toBe(2);
    expect(state.spectatorCount).toBe(5);
  });

  test('shows the persisted winner at the awards plaza', () => {
    const state = buildEventOverlayState(snapshot(6, 'p:0'));
    expect(state.activeCheckpoint).toEqual(trialIslandCheckpoints.awards);
    expect(state.winner?.displayName).toBe('居民0');
  });

  test('keeps every visible facility inside the 84×30 map and on a walkable tile', () => {
    for (const checkpoint of Object.values(trialIslandCheckpoints)) {
      expect(checkpoint.x).toBeGreaterThanOrEqual(48);
      expect(checkpoint.x).toBeLessThan(mapwidth);
      expect(checkpoint.y).toBeGreaterThanOrEqual(0);
      expect(checkpoint.y).toBeLessThan(mapheight);
      expect(objmap.every((layer) => layer[checkpoint.x][checkpoint.y] === -1)).toBe(true);
    }
  });
});
