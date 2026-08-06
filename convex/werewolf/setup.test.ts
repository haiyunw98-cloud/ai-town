import { createWerewolfSetup } from './setup';

const ai = Array.from({ length: 9 }, (_, index) => ({
  playerId: `p:${index}`,
  displayName: `居民${index}`,
  kind: 'ai' as const,
}));

describe('werewolf setup', () => {
  test('assigns exactly three wolves, three villagers, and three special roles', () => {
    const setup = createWerewolfSetup(ai, 20260806);

    expect(setup).toHaveLength(9);
    expect(setup.map((seat) => seat.seatNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(setup.map((seat) => seat.role).sort()).toEqual(
      ['hunter', 'seer', 'villager', 'villager', 'villager', 'werewolf', 'werewolf', 'werewolf', 'witch'].sort(),
    );
  });

  test('is deterministic for a recorded seed and changes assignment for another seed', () => {
    expect(createWerewolfSetup(ai, 7)).toEqual(createWerewolfSetup(ai, 7));
    expect(createWerewolfSetup(ai, 7).map((seat) => seat.role))
      .not.toEqual(createWerewolfSetup(ai, 8).map((seat) => seat.role));
  });

  test('keeps one human entrant when the observer joins', () => {
    const setup = createWerewolfSetup([
      ...ai.slice(0, 8),
      { playerId: 'p:human', displayName: '你', kind: 'human' as const },
    ], 11);

    expect(setup.filter((seat) => seat.kind === 'human')).toHaveLength(1);
    expect(setup.find((seat) => seat.kind === 'human')?.displayName).toBe('你');
  });

  test('rejects malformed or duplicate nine-seat rosters', () => {
    expect(() => createWerewolfSetup(ai.slice(0, 8), 1)).toThrow(/nine|9/iu);
    expect(() => createWerewolfSetup([...ai.slice(0, 8), ai[0]], 1)).toThrow(/unique/iu);
    expect(() => createWerewolfSetup(ai, Number.NaN)).toThrow(/seed|integer/iu);
  });
});
