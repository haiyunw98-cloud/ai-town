import { objmap, werewolfCheckpoints } from '../../data/worlds/lighthouse-town/map';
import { buildWerewolfMovementCommands } from './movement';
import type { WerewolfRole, WerewolfSeat } from './types';

const roles: WerewolfRole[] = [
  'werewolf', 'werewolf', 'werewolf', 'villager', 'villager',
  'villager', 'seer', 'witch', 'hunter',
];

function seats(): WerewolfSeat[] {
  return roles.map((role, index) => ({
    playerId: `p:${index}`,
    displayName: `居民${index}`,
    kind: 'ai',
    seatNumber: index + 1,
    role,
    alive: index !== 3,
    eliminatedRound: index === 3 ? 1 : undefined,
    eliminatedBy: index === 3 ? 'wolves' : undefined,
    antidoteAvailable: role === 'witch',
    poisonAvailable: role === 'witch',
    hunterShotAvailable: role === 'hunter',
  }));
}

describe('werewolf map movement', () => {
  test('nine table seats and spectator positions are unique walkable tiles', () => {
    const points = [...werewolfCheckpoints.seats, ...werewolfCheckpoints.spectators];
    expect(new Set(points.map(({ x, y }) => `${x}:${y}`)).size).toBe(points.length);
    for (const point of points) expect(objmap[0][point.x][point.y]).toBe(-1);
  });

  test('seating uses seat numbers and eliminated residents walk to the spectator row', () => {
    const seating = buildWerewolfMovementCommands(seats(), 'seating', 1000);
    expect(seating).toHaveLength(9);
    expect(seating.map((command) => command.destination)).toEqual(werewolfCheckpoints.seats);

    const elimination = buildWerewolfMovementCommands(seats(), 'elimination', 2000);
    expect(elimination).toHaveLength(1);
    expect(elimination[0].residentId).toBe('p:3');
    expect(elimination[0].description).toContain('观众席');
  });

  test('human seats are represented by the overlay and never sent to the movement engine', () => {
    const playSeats = seats().map((seat, index) => index === 0 ? { ...seat, kind: 'human' as const } : seat);
    expect(buildWerewolfMovementCommands(playSeats, 'seating', 1000)).toHaveLength(8);
  });
});
