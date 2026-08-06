import { initialTheatreQueue, phaseDwellMs } from './useWerewolfTheatre';

describe('werewolf theatre pacing', () => {
  test('night has a visible dwell and speed changes presentation time only', () => {
    expect(phaseDwellMs('night-wolves', 1)).toBe(6000);
    expect(phaseDwellMs('night-wolves', 2)).toBe(3000);
    expect(phaseDwellMs('dawn', 1)).toBe(5000);
  });

  test('an observer entering a fast first round still sees night before day', () => {
    expect(initialTheatreQueue('day-speaking', 1, true)).toEqual([
      'night-wolves', 'night-seer', 'night-witch', 'dawn', 'day-speaking',
    ]);
    expect(initialTheatreQueue('day-speaking', 1, false)).toEqual(['day-speaking']);
    expect(initialTheatreQueue('day-voting', 2, true)).toEqual(['day-voting']);
  });
});
