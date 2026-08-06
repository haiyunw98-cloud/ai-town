import { phaseDwellMs, theatreStepsForSnapshot } from './useWerewolfTheatre';

describe('werewolf theatre pacing', () => {
  test('night has a visible dwell and speed changes presentation time only', () => {
    expect(phaseDwellMs('night-wolves', 1)).toBe(6000);
    expect(phaseDwellMs('night-wolves', 2)).toBe(3000);
    expect(phaseDwellMs('dawn', 1)).toBe(5000);
  });

  test('an observer entering a fast first round still sees night before day', () => {
    expect(theatreStepsForSnapshot(undefined, 'day-speaking', 1, true)).toEqual([
      { phase: 'night-wolves', round: 1 },
      { phase: 'night-seer', round: 1 },
      { phase: 'night-witch', round: 1 },
      { phase: 'dawn', round: 1 },
      { phase: 'day-speaking', round: 1 },
    ]);
    expect(theatreStepsForSnapshot(undefined, 'day-speaking', 1, false)).toEqual([
      { phase: 'day-speaking', round: 1 },
    ]);
    expect(theatreStepsForSnapshot(undefined, 'day-voting', 2, true)).toEqual([
      { phase: 'day-voting', round: 2 },
    ]);
  });

  test('appends only unseen forward phases and keeps rounds distinct', () => {
    expect(theatreStepsForSnapshot(
      { phase: 'night-seer', round: 1 }, 'night-witch', 1, true,
    )).toEqual([{ phase: 'night-witch', round: 1 }]);
    expect(theatreStepsForSnapshot(
      { phase: 'day-voting', round: 1 }, 'night-seer', 2, true,
    )).toEqual([
      { phase: 'night-wolves', round: 2 },
      { phase: 'night-seer', round: 2 },
    ]);
    expect(theatreStepsForSnapshot(
      { phase: 'dawn', round: 2 }, 'dawn', 2, true,
    )).toEqual([]);
  });
});
