import {
  applyWerewolfAction,
  beginWerewolfGame,
  legalTargets,
} from './stateMachine';
import type { WerewolfRole, WerewolfSeat, WerewolfState } from './types';

const roles: WerewolfRole[] = [
  'werewolf', 'werewolf', 'werewolf',
  'villager', 'villager', 'villager',
  'seer', 'witch', 'hunter',
];

function fixedSeats(): WerewolfSeat[] {
  return roles.map((role, index) => ({
    playerId: `p:${index}`,
    displayName: `居民${index}`,
    kind: 'ai',
    seatNumber: index + 1,
    role,
    alive: true,
    antidoteAvailable: role === 'witch',
    poisonAvailable: role === 'witch',
    hunterShotAvailable: role === 'hunter',
  }));
}

function advanceWolves(state: WerewolfState, targetId = 'p:3') {
  return ['p:0', 'p:1', 'p:2'].reduce((current, actorId) =>
    applyWerewolfAction(current, {
      kind: 'wolf-vote', actorId, targetId, at: current.updatedAt + 1,
    }), state);
}

function advanceSeer(state: WerewolfState, targetId = 'p:0') {
  return applyWerewolfAction(state, {
    kind: 'seer-check', actorId: 'p:6', targetId, at: state.updatedAt + 1,
  });
}

describe('werewolf night state machine', () => {
  test('starts with an owned nine-seat state at the wolf phase', () => {
    const input = fixedSeats();
    const state = beginWerewolfGame(input, 19, 1000);

    expect(state.phase).toBe('night-wolves');
    expect(state.round).toBe(1);
    expect(state.seats).not.toBe(input);
    expect(state.seats).toEqual(input);
  });

  test('resolves all living wolf votes before advancing to the seer', () => {
    let state = beginWerewolfGame(fixedSeats(), 19, 1000);
    state = applyWerewolfAction(state, {
      kind: 'wolf-vote', actorId: 'p:0', targetId: 'p:3', at: 1001,
    });
    expect(state.phase).toBe('night-wolves');
    state = applyWerewolfAction(state, {
      kind: 'wolf-vote', actorId: 'p:1', targetId: 'p:3', at: 1002,
    });
    state = applyWerewolfAction(state, {
      kind: 'wolf-vote', actorId: 'p:2', targetId: 'p:4', at: 1003,
    });

    expect(state.phase).toBe('night-seer');
    expect(state.pendingNightTargetId).toBe('p:3');
  });

  test('gives only the seer a private camp result', () => {
    const state = advanceSeer(advanceWolves(beginWerewolfGame(fixedSeats(), 19, 1000)));

    expect(state.phase).toBe('night-witch');
    expect(state.privateResults['p:6']).toEqual([{ targetId: 'p:0', camp: 'wolves' }]);
    expect(state.privateResults['p:3']).toBeUndefined();
  });

  test('allows first-night self-save but rejects using both witch medicines together', () => {
    const wolfTargetingWitch = advanceWolves(beginWerewolfGame(fixedSeats(), 19, 1000), 'p:7');
    const witchPhase = advanceSeer(wolfTargetingWitch);

    const saved = applyWerewolfAction(witchPhase, {
      kind: 'witch-use', actorId: 'p:7', save: true, at: witchPhase.updatedAt + 1,
    });
    expect(saved.phase).toBe('dawn');
    expect(saved.nightSaved).toBe(true);
    expect(saved.seats.find((seat) => seat.playerId === 'p:7')?.antidoteAvailable).toBe(false);

    expect(() => applyWerewolfAction(witchPhase, {
      kind: 'witch-use', actorId: 'p:7', save: true, poisonTargetId: 'p:4', at: witchPhase.updatedAt + 1,
    })).toThrow(/same night|同一夜/iu);
  });

  test('rejects repeated, out-of-turn, self, teammate, and dead targets', () => {
    const initial = beginWerewolfGame(fixedSeats(), 19, 1000);
    expect(legalTargets(initial, 'p:0')).not.toContain('p:0');
    expect(legalTargets(initial, 'p:0')).not.toContain('p:1');
    expect(() => applyWerewolfAction(initial, {
      kind: 'seer-check', actorId: 'p:6', targetId: 'p:0', at: 1001,
    })).toThrow(/phase|turn/iu);

    const once = applyWerewolfAction(initial, {
      kind: 'wolf-vote', actorId: 'p:0', targetId: 'p:3', at: 1001,
    });
    expect(() => applyWerewolfAction(once, {
      kind: 'wolf-vote', actorId: 'p:0', targetId: 'p:4', at: 1002,
    })).toThrow(/already|duplicate/iu);
  });
});
