import { advanceEvent, createInitialEvent } from './stateMachine';

const eightResidents = ['林澜', '白露', '墨七', '沈砚', '顾潮', '唐果', '苏萤', '阿满'].map(
  (displayName, index) => ({ residentId: `p:${index}`, displayName }),
);

describe('town challenge state machine', () => {
  test('advances eight residents through every round to one winner', () => {
    let event = createInitialEvent('world-1', eightResidents, 42, 1_000);
    expect(event.phase).toBe('announcement');
    expect(event.activeCount).toBe(8);

    event = advanceEvent(event, event.phaseEndsAt);
    expect(event.phase).toBe('treasureHunt');
    expect(event.activeCount).toBe(8);

    event = advanceEvent(event, event.phaseEndsAt);
    expect(event.phase).toBe('lanternRelay');
    expect(event.activeCount).toBe(6);

    event = advanceEvent(event, event.phaseEndsAt);
    expect(event.phase).toBe('secretTrade');
    expect(event.activeCount).toBe(4);

    event = advanceEvent(event, event.phaseEndsAt);
    expect(event.phase).toBe('lighthouseFinal');
    expect(event.activeCount).toBe(2);

    event = advanceEvent(event, event.phaseEndsAt);
    expect(event.phase).toBe('awards');
    expect(event.activeCount).toBe(1);
    expect(event.winnerId).toBeTruthy();
    expect(event.participants.find((participant) => participant.residentId === event.winnerId)?.role)
      .toBe('winner');
  });

  test('is deterministic for a recorded seed and ignores duplicate completion ticks', () => {
    const run = () => {
      let event = createInitialEvent('world-1', eightResidents, 2026, 10_000);
      while (event.phase !== 'awards') event = advanceEvent(event, event.phaseEndsAt);
      return event;
    };

    const first = run();
    const second = run();
    expect(second).toEqual(first);
    expect(advanceEvent(first, first.phaseEndsAt + 60_000)).toEqual(first);
    expect(new Set(first.log.map((entry) => entry.eventKey)).size).toBe(first.log.length);
  });

  test('does not advance before the current phase deadline', () => {
    const event = createInitialEvent('world-1', eightResidents, 7, 5_000);
    expect(advanceEvent(event, event.phaseEndsAt - 1)).toBe(event);
  });
});
