import { verifyDailyEventRuntime } from './verify-daily-event-runtime';

describe('accelerated daily event runtime verification', () => {
  test('rehearses the complete safe two-hour lifecycle', () => {
    const result = verifyDailyEventRuntime();
    expect(result).toMatchObject({
      ok: true,
      mode: 'accelerated-isolated-rehearsal',
      durationMinutes: 120,
      venue: 'trial-island',
      rewards: { rows: 14, total: 220, unique: true },
      returnCommands: 9,
    });
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
    expect(result.stageResults.map((stage) => stage.active)).toEqual([9, 8, 6, 6, 4, 1, 1]);
  });
});
