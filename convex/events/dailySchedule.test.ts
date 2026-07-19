import {
  DAILY_TEMPLATE_IDS,
  dailyEventAction,
  dailyEventWindow,
  selectDailyTemplate,
  shanghaiEventDayKey,
} from './dailySchedule';
import type { ExistingDailyEvent } from './dailySchedule';

function existingEvent(
  dayKey: string,
  status: ExistingDailyEvent['status'],
  stageIndex: number,
): ExistingDailyEvent {
  return { dayKey, status, stageIndex } as ExistingDailyEvent;
}

describe('daily event Shanghai schedule', () => {
  test('uses the exact Shanghai 12:00 inclusive to 14:00 exclusive window', () => {
    expect(dailyEventWindow(Date.parse('2026-07-17T03:59:59Z'))).toEqual({
      state: 'before',
      stageIndex: -1,
    });
    expect(dailyEventWindow(Date.parse('2026-07-17T04:00:00Z'))).toMatchObject({
      state: 'live',
      stageIndex: 0,
      elapsedMinutes: 0,
    });
    expect(dailyEventWindow(Date.parse('2026-07-17T05:15:00Z'))).toMatchObject({
      state: 'live',
      stageIndex: 4,
      elapsedMinutes: 75,
    });
    expect(dailyEventWindow(Date.parse('2026-07-17T05:59:59Z'))).toMatchObject({
      state: 'live',
      stageIndex: 6,
    });
    expect(dailyEventWindow(Date.parse('2026-07-17T06:00:00Z'))).toEqual({
      state: 'after',
      stageIndex: 7,
    });
  });

  test('derives a stable calendar day in Asia/Shanghai', () => {
    expect(shanghaiEventDayKey(Date.parse('2026-07-16T15:59:59Z'))).toBe('2026-07-16');
    expect(shanghaiEventDayKey(Date.parse('2026-07-16T16:00:00Z'))).toBe('2026-07-17');
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects an invalid timestamp instead of deriving schedule state: %s',
    (timestamp) => {
      expect(() => shanghaiEventDayKey(timestamp)).toThrow(RangeError);
      expect(() => dailyEventWindow(timestamp)).toThrow(RangeError);
      expect(() => dailyEventAction(timestamp, 'running', null)).toThrow(RangeError);
    },
  );

  test('does not repeat any template used during the previous six days', () => {
    const previous = [
      'safe-survival',
      'town-relay',
      'island-resources',
      'market-business',
      'community-service',
      'cooking-craft',
    ];
    expect(selectDailyTemplate('2026-07-17', previous)).toBe('relay-build');
  });

  test('accepts the six most recent templates returned in Convex descending order', () => {
    const mostRecentFirst = [
      'cooking-craft',
      'community-service',
      'market-business',
      'island-resources',
      'town-relay',
      'safe-survival',
    ];
    expect(selectDailyTemplate('2026-07-17', mostRecentFirst)).toBe('relay-build');
  });

  test('rejects more than the six most recent template ids instead of slicing an unordered list', () => {
    expect(() => selectDailyTemplate('2026-07-17', [...DAILY_TEMPLATE_IDS])).toThrow(
      /at most six/i,
    );
  });

  test('always makes a deterministic selection from the seven known templates', () => {
    const first = selectDailyTemplate('2026-07-24', []);
    expect(DAILY_TEMPLATE_IDS).toContain(first);
    expect(selectDailyTemplate('2026-07-24', [])).toBe(first);
  });
});

describe('daily event action while the world is paused or stopped', () => {
  const live = Date.parse('2026-07-17T05:15:00Z');
  const after = Date.parse('2026-07-17T06:00:00Z');

  test.each(['inactive', 'stoppedByDeveloper'] as const)(
    'does not create or advance an event while world status is %s',
    (worldStatus) => {
      expect(dailyEventAction(live, worldStatus, null)).toEqual({ kind: 'none' });
      expect(
        dailyEventAction(live, worldStatus, existingEvent('2026-07-17', 'running', 1)),
      ).toEqual({ kind: 'none' });
    },
  );

  test('catches a running world up to the current stage without duplicate advancement', () => {
    expect(dailyEventAction(live, 'running', null)).toEqual({
      kind: 'create',
      stageIndex: 4,
    });
    expect(
      dailyEventAction(live, 'running', existingEvent('2026-07-17', 'running', 2)),
    ).toEqual({ kind: 'advance', stageIndex: 4 });
    expect(
      dailyEventAction(live, 'running', existingEvent('2026-07-17', 'running', 4)),
    ).toEqual({ kind: 'none' });
  });

  test('rejects a previous-day event instead of advancing or archiving it as today', () => {
    const stale = existingEvent('2026-07-16', 'running', 2);
    expect(() => dailyEventAction(live, 'running', stale)).toThrow(/day key/i);
    expect(() => dailyEventAction(after, 'running', stale)).toThrow(/day key/i);
  });

  test('records a missed day or archives after the window according to world state', () => {
    expect(dailyEventAction(after, 'running', null)).toEqual({ kind: 'record-missed' });
    expect(
      dailyEventAction(after, 'running', existingEvent('2026-07-17', 'running', 4)),
    ).toEqual({ kind: 'archive', stageIndex: 6 });
    expect(
      dailyEventAction(after, 'inactive', existingEvent('2026-07-17', 'running', 4)),
    ).toEqual({ kind: 'archive-paused' });
    expect(
      dailyEventAction(
        after,
        'stoppedByDeveloper',
        existingEvent('2026-07-17', 'running', 4),
      ),
    ).toEqual({ kind: 'archive-paused' });
    expect(
      dailyEventAction(after, 'running', existingEvent('2026-07-17', 'completed', 6)),
    ).toEqual({ kind: 'none' });
  });
});
