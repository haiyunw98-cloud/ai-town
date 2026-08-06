import {
  applySystemStep,
  applyWerewolfAction,
  beginWerewolfGame,
  evaluateWinner,
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

function stateAtDawn(targetId = 'p:3') {
  const witchPhase = advanceSeer(advanceWolves(
    beginWerewolfGame(fixedSeats(), 19, 1000), targetId,
  ));
  return applyWerewolfAction(witchPhase, {
    kind: 'witch-use', actorId: 'p:7', save: false, at: witchPhase.updatedAt + 1,
  });
}

function stateAtDayVoting(targetId = 'p:3') {
  let state = applySystemStep(stateAtDawn(targetId), 2000);
  for (const actorId of [...state.speakingOrder]) {
    state = applyWerewolfAction(state, {
      kind: 'speech', actorId, text: '我会结合票型再判断。', at: state.updatedAt + 1,
    });
  }
  return state;
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

describe('werewolf day state machine', () => {
  test('dawn applies eliminations and every living player speaks before voting', () => {
    let state = applySystemStep(stateAtDawn(), 2000);
    expect(state.seats.find((seat) => seat.playerId === 'p:3')?.alive).toBe(false);
    expect(state.phase).toBe('day-speaking');

    for (const actorId of [...state.speakingOrder]) {
      state = applyWerewolfAction(state, {
        kind: 'speech', actorId, text: '我先听大家怎么说。', at: state.updatedAt + 1,
      });
    }
    expect(state.phase).toBe('day-voting');
  });

  test('a first tie creates a runoff and a second tie eliminates nobody', () => {
    let state = stateAtDayVoting();
    const voters = state.seats.filter((seat) => seat.alive).map((seat) => seat.playerId);
    const firstTargets: Record<string, string | undefined> = {
      'p:0': 'p:1', 'p:1': 'p:0', 'p:2': 'p:0', 'p:4': 'p:0',
      'p:5': 'p:1', 'p:6': 'p:1', 'p:7': undefined, 'p:8': undefined,
    };
    voters.forEach((actorId, index) => {
      state = applyWerewolfAction(state, {
        kind: 'day-vote', actorId, targetId: firstTargets[actorId], at: state.updatedAt + 1,
      });
    });
    expect(state.phase).toBe('runoff-speaking');
    expect(state.runoffIds).toEqual(['p:0', 'p:1']);

    for (const actorId of [...state.speakingOrder]) {
      state = applyWerewolfAction(state, {
        kind: 'speech', actorId, text: '请根据发言重新投票。', at: state.updatedAt + 1,
      });
    }
    const runoffVoters = state.seats.filter((seat) => seat.alive).map((seat) => seat.playerId);
    runoffVoters.forEach((actorId) => {
      state = applyWerewolfAction(state, {
        kind: 'day-vote', actorId,
        targetId: firstTargets[actorId],
        at: state.updatedAt + 1,
      });
    });
    expect(state.phase).toBe('night-wolves');
    expect(state.round).toBe(2);
    expect(state.seats.filter((seat) => seat.alive)).toHaveLength(8);
  });

  test('a voted hunter may take one player, but a poisoned hunter may not shoot', () => {
    let voted = stateAtDayVoting();
    const voters = voted.seats.filter((seat) => seat.alive).map((seat) => seat.playerId);
    voters.forEach((actorId) => {
      voted = applyWerewolfAction(voted, {
        kind: 'day-vote', actorId,
        targetId: actorId === 'p:8' ? undefined : 'p:8',
        at: voted.updatedAt + 1,
      });
    });
    expect(voted.phase).toBe('hunter');
    voted = applyWerewolfAction(voted, {
      kind: 'hunter-shot', actorId: 'p:8', targetId: 'p:0', at: voted.updatedAt + 1,
    });
    expect(voted.seats.find((seat) => seat.playerId === 'p:0')?.eliminatedBy).toBe('hunter');

    let poisoned = advanceSeer(advanceWolves(beginWerewolfGame(fixedSeats(), 19, 1000)));
    poisoned = applyWerewolfAction(poisoned, {
      kind: 'witch-use', actorId: 'p:7', save: false, poisonTargetId: 'p:8',
      at: poisoned.updatedAt + 1,
    });
    poisoned = applySystemStep(poisoned, 2000);
    expect(poisoned.phase).not.toBe('hunter');
    expect(poisoned.seats.find((seat) => seat.playerId === 'p:8')?.eliminatedBy).toBe('witch');
  });

  test('evaluates both victory conditions', () => {
    const goodWin = fixedSeats().map((seat) => seat.role === 'werewolf' ? { ...seat, alive: false } : seat);
    expect(evaluateWinner(goodWin)).toBe('good');

    const wolfWin = fixedSeats().map((seat) =>
      ['p:3', 'p:4', 'p:5', 'p:6'].includes(seat.playerId) ? { ...seat, alive: false } : seat,
    );
    expect(evaluateWinner(wolfWin)).toBe('wolves');
  });
});
