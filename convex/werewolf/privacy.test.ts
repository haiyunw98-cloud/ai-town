import { buildWerewolfViewerState } from './privacy';
import { applyWerewolfAction, beginWerewolfGame } from './stateMachine';
import type { WerewolfRole, WerewolfSeat, WerewolfState } from './types';

const roles: WerewolfRole[] = [
  'werewolf', 'werewolf', 'werewolf',
  'villager', 'villager', 'villager',
  'seer', 'witch', 'hunter',
];

function seats(): WerewolfSeat[] {
  return roles.map((role, index) => ({
    playerId: `p:${index}`,
    displayName: `居民${index}`,
    kind: index === 3 ? 'human' : 'ai',
    seatNumber: index + 1,
    role,
    alive: true,
    antidoteAvailable: role === 'witch',
    poisonAvailable: role === 'witch',
    hunterShotAvailable: role === 'hunter',
  }));
}

function stateWithSecrets() {
  let state = beginWerewolfGame(seats(), 19, 1000);
  for (const actorId of ['p:0', 'p:1', 'p:2']) {
    state = applyWerewolfAction(state, {
      kind: 'wolf-vote', actorId, targetId: 'p:3', at: state.updatedAt + 1,
    });
  }
  return applyWerewolfAction(state, {
    kind: 'seer-check', actorId: 'p:6', targetId: 'p:0', at: state.updatedAt + 1,
  });
}

describe('werewolf viewer privacy', () => {
  test('a villager sees only their own role and no night actions', () => {
    const view = buildWerewolfViewerState(stateWithSecrets(), 'p:3');
    expect(view.privateRole).toBe('villager');
    expect(view.seats.every((seat) => seat.role === undefined)).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/seer-check|wolf-vote|pendingNightTargetId/u);
  });

  test('wolves know living teammates but never receive teammate choices', () => {
    const view = buildWerewolfViewerState(stateWithSecrets(), 'p:0');
    expect(view.privateRole).toBe('werewolf');
    expect(view.knownWolfIds).toEqual(['p:0', 'p:1', 'p:2']);
    expect(JSON.stringify(view)).not.toMatch(/wolf-vote|pendingWolfVotes/u);
  });

  test('seer and witch receive only their own night information', () => {
    const state = stateWithSecrets();
    const seer = buildWerewolfViewerState(state, 'p:6');
    expect(seer.seerResults).toEqual([{ targetId: 'p:0', camp: 'wolves' }]);
    expect(seer.witchNoticeTargetId).toBeUndefined();

    const witch = buildWerewolfViewerState(state, 'p:7');
    expect(witch.witchNoticeTargetId).toBe('p:3');
    expect(witch.antidoteAvailable).toBe(true);
    expect(witch.seerResults).toBeUndefined();
  });

  test('observer sees no roles before completion and all roles after completion', () => {
    const running = stateWithSecrets();
    expect(buildWerewolfViewerState(running).seats.every((seat) => !seat.role)).toBe(true);
    const completed: WerewolfState = { ...running, phase: 'completed', winner: 'good' };
    expect(buildWerewolfViewerState(completed).seats.every((seat) => !!seat.role)).toBe(true);
  });

  test('god observer receives night theatre actions while a player never does', () => {
    const state = stateWithSecrets();
    const observer = buildWerewolfViewerState(state, undefined, 'observe');
    expect(observer.observerSecrets?.roles['p:0']).toBe('werewolf');
    expect(observer.observerSecrets?.nightActions.some((action) => action.kind === 'wolf-vote'))
      .toBe(true);
    expect(observer.observerSecrets?.pendingNightTargetId).toBe('p:3');

    const player = buildWerewolfViewerState(state, 'p:3', 'play');
    expect(player.observerSecrets).toBeUndefined();
    expect(JSON.stringify(player)).not.toMatch(/wolf-vote|seer-check/u);
  });

  test('publishes an auditable dawn result without exposing private night actions', () => {
    const running = stateWithSecrets();
    const afterDawn: WerewolfState = {
      ...running,
      phase: 'day-speaking',
      seats: running.seats.map((seat) => seat.playerId === 'p:3' ? {
        ...seat, alive: false, eliminatedRound: 1, eliminatedBy: 'wolves',
      } : seat),
    };
    const player = buildWerewolfViewerState(afterDawn, 'p:4', 'play');
    expect(player.dawnResults).toEqual([{ round: 1, eliminatedPlayerIds: ['p:3'] }]);
    expect(JSON.stringify(player)).not.toMatch(/wolf-vote|seer-check/u);

    const peaceful: WerewolfState = { ...running, phase: 'day-speaking' };
    expect(buildWerewolfViewerState(peaceful).dawnResults)
      .toEqual([{ round: 1, eliminatedPlayerIds: [] }]);

    const unsettledDawn: WerewolfState = { ...running, phase: 'dawn' };
    expect(buildWerewolfViewerState(unsettledDawn).dawnResults).toEqual([]);
  });
});
