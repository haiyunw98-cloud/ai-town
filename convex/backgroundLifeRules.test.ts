import {
  BACKGROUND_LIFE_MAX_CATCH_UP_MS,
  BACKGROUND_LIFE_SLOT_MS,
  backgroundLifeActionForSlot,
  backgroundLifeIdempotencyKey,
  backgroundLifeModeForWorldStatus,
  backgroundLifeSlotsToProcess,
  floorBackgroundLifeSlot,
} from './backgroundLifeRules';

describe('background life deterministic rules', () => {
  const shanghaiMorning = Date.parse('2026-07-19T09:15:00+08:00');

  test('uses stable half-hour slots', () => {
    expect(floorBackgroundLifeSlot(shanghaiMorning)).toBe(
      Date.parse('2026-07-19T09:00:00+08:00'),
    );
    expect(floorBackgroundLifeSlot(shanghaiMorning + BACKGROUND_LIFE_SLOT_MS - 1)).toBe(
      Date.parse('2026-07-19T09:30:00+08:00'),
    );
  });

  test('rotates residents and derives ordinary day-part actions deterministically', () => {
    const first = backgroundLifeActionForSlot(shanghaiMorning, 9);
    const replay = backgroundLifeActionForSlot(shanghaiMorning, 9);
    const next = backgroundLifeActionForSlot(
      shanghaiMorning + BACKGROUND_LIFE_SLOT_MS,
      9,
    );
    expect(first).toEqual(replay);
    expect(first.kind).toBe('work');
    expect(next.residentIndex).toBe((first.residentIndex + 1) % 9);

    expect(
      backgroundLifeActionForSlot(Date.parse('2026-07-19T12:15:00+08:00'), 9).kind,
    ).toBe('purchase');
    expect(
      backgroundLifeActionForSlot(Date.parse('2026-07-19T19:15:00+08:00'), 9).kind,
    ).toBe('social');
    expect(
      backgroundLifeActionForSlot(Date.parse('2026-07-19T02:15:00+08:00'), 9).kind,
    ).toBe('rest');
  });

  test('always chooses a different social partner', () => {
    const action = backgroundLifeActionForSlot(
      Date.parse('2026-07-19T19:15:00+08:00'),
      9,
    );
    expect(action.partnerIndex).toBeDefined();
    expect(action.partnerIndex).not.toBe(action.residentIndex);
  });

  test('bounds each batch and detailed catch-up to seven days', () => {
    const current = floorBackgroundLifeSlot(shanghaiMorning);
    const veryOld = current - BACKGROUND_LIFE_MAX_CATCH_UP_MS * 2;
    const result = backgroundLifeSlotsToProcess(veryOld, current, 12);
    expect(result.slots).toHaveLength(12);
    expect(result.skippedBefore).toBeGreaterThan(veryOld);
    expect(result.slots[0]).toBeGreaterThanOrEqual(
      current - BACKGROUND_LIFE_MAX_CATCH_UP_MS,
    );
    expect(result.hasMore).toBe(true);
  });

  test('builds canonical replay-safe keys', () => {
    expect(backgroundLifeIdempotencyKey('worlds:abc', shanghaiMorning, 'work')).toBe(
      `background:worlds:abc:${floorBackgroundLifeSlot(shanghaiMorning)}:work`,
    );
  });

  test('simulates only inactive worlds and treats manual pause as a hard stop', () => {
    expect(backgroundLifeModeForWorldStatus('inactive')).toBe('simulate');
    expect(backgroundLifeModeForWorldStatus('running')).toBe('foreground');
    expect(backgroundLifeModeForWorldStatus('stoppedByDeveloper')).toBe(
      'hold-without-catch-up',
    );
  });

  test('rejects invalid timestamps and resident counts', () => {
    expect(() => floorBackgroundLifeSlot(Number.NaN)).toThrow('timestamp');
    expect(() => backgroundLifeActionForSlot(shanghaiMorning, 1)).toThrow('residentCount');
    expect(() => backgroundLifeSlotsToProcess(shanghaiMorning, shanghaiMorning, 0)).toThrow(
      'batchSize',
    );
  });
});
