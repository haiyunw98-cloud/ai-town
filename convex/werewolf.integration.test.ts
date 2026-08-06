import fs from 'node:fs';
import path from 'node:path';
import {
  assertWerewolfCanStart,
  buildSessionEntrants,
  werewolfActionKey,
} from './werewolf';

const schemaSource = fs.readFileSync(path.join(process.cwd(), 'convex/schema.ts'), 'utf8');
const roster = Array.from({ length: 9 }, (_, index) => ({
  residentId: `p:${index}`,
  displayName: `居民${index}`,
  identity: `居民${index}的性格设定`,
}));

describe('werewolf persistence boundary', () => {
  test('schema contains dedicated session, seat, and idempotent action tables', () => {
    expect(schemaSource).toContain('werewolfSessions: defineTable');
    expect(schemaSource).toContain('werewolfSeats: defineTable');
    expect(schemaSource).toContain('werewolfActions: defineTable');
    expect(schemaSource).toContain(".index('sessionKey', ['worldId', 'status'])");
    expect(schemaSource).toContain(".index('actionKey', ['sessionId', 'actionKey'])");
  });

  test('start guard rejects a daily event or another active session', () => {
    expect(() => assertWerewolfCanStart({ runningDailyEvent: true, runningWerewolf: false }))
      .toThrow(/活动|busy/iu);
    expect(() => assertWerewolfCanStart({ runningDailyEvent: false, runningWerewolf: true }))
      .toThrow(/进行中|active/iu);
  });

  test('play mode has one human and eight AI while observe mode has nine AI', () => {
    const play = buildSessionEntrants(roster, 'play', 19);
    expect(play.entrants.filter((seat) => seat.kind === 'human')).toHaveLength(1);
    expect(play.entrants.filter((seat) => seat.kind === 'ai')).toHaveLength(8);
    expect(play.spectator).toBeDefined();

    const observe = buildSessionEntrants(roster, 'observe', 19);
    expect(observe.entrants.filter((seat) => seat.kind === 'human')).toHaveLength(0);
    expect(observe.entrants.filter((seat) => seat.kind === 'ai')).toHaveLength(9);
    expect(observe.spectator).toBeUndefined();
  });

  test('action keys are stable per actor, round, and phase', () => {
    expect(werewolfActionKey('session:1', 2, 'day-voting', 'p:3'))
      .toBe('session:1:2:day-voting:p:3');
  });
});
