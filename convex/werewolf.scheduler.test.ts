import {
  humanTurnDeadline,
  selectPendingActor,
  sessionRunMode,
} from './werewolf';
import { applyWerewolfAction, beginWerewolfGame } from './werewolf/stateMachine';
import type { WerewolfRole, WerewolfSeat } from './werewolf/types';

const roles: WerewolfRole[] = [
  'werewolf', 'werewolf', 'werewolf', 'villager', 'villager',
  'villager', 'seer', 'witch', 'hunter',
];

function state(humanId?: string) {
  const seats: WerewolfSeat[] = roles.map((role, index) => ({
    playerId: `p:${index}`,
    displayName: `居民${index}`,
    kind: `p:${index}` === humanId ? 'human' : 'ai',
    seatNumber: index + 1,
    role,
    alive: true,
    antidoteAvailable: role === 'witch',
    poisonAvailable: role === 'witch',
    hunterShotAvailable: role === 'hunter',
  }));
  return beginWerewolfGame(seats, 19, 1000);
}

describe('werewolf resilient scheduler helpers', () => {
  test('selects exactly the first pending actor and advances after their action', () => {
    let current = state();
    expect(selectPendingActor(current)).toMatchObject({ actorId: 'p:0', requested: 'target' });
    current = applyWerewolfAction(current, {
      kind: 'wolf-vote', actorId: 'p:0', targetId: 'p:3', at: 1001,
    });
    expect(selectPendingActor(current)).toMatchObject({ actorId: 'p:1', requested: 'target' });
  });

  test('marks a human turn without scheduling an AI decision', () => {
    expect(selectPendingActor(state('p:0'))).toEqual({
      actorId: 'p:0', kind: 'wolf-vote', requested: 'target', human: true,
    });
  });

  test('human deadline is ninety seconds and is stable across duplicate wakeups', () => {
    expect(humanTurnDeadline(1000)).toBe(91000);
    expect(humanTurnDeadline(5000, 91000)).toBe(91000);
  });

  test('developer pause and inactive worlds sleep instead of running models', () => {
    expect(sessionRunMode('running')).toBe('run');
    expect(sessionRunMode('stoppedByDeveloper')).toBe('pause');
    expect(sessionRunMode('inactive')).toBe('pause');
  });
});
