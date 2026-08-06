import type { WerewolfEntrant, WerewolfRole, WerewolfSeat } from './types';

const ROLES: readonly WerewolfRole[] = [
  'werewolf',
  'werewolf',
  'werewolf',
  'villager',
  'villager',
  'villager',
  'seer',
  'witch',
  'hunter',
];

function nextRandom(state: number) {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

export function createWerewolfSetup(
  entrants: readonly WerewolfEntrant[],
  seed: number,
): WerewolfSeat[] {
  if (entrants.length !== 9) throw new Error('Werewolf requires exactly nine entrants.');
  if (new Set(entrants.map((entry) => entry.playerId)).size !== 9) {
    throw new Error('Werewolf entrants must be unique.');
  }
  if (!Number.isSafeInteger(seed)) throw new Error('Werewolf seed must be an integer.');
  if (entrants.some((entry) => !entry.playerId.trim() || !entry.displayName.trim())) {
    throw new Error('Werewolf entrants require non-empty identities.');
  }
  if (entrants.filter((entry) => entry.kind === 'human').length > 1) {
    throw new Error('Werewolf supports at most one human entrant.');
  }

  const roles = [...ROLES];
  let state = (seed >>> 0) || 0x9e3779b9;
  for (let index = roles.length - 1; index > 0; index -= 1) {
    state = nextRandom(state + index);
    const target = state % (index + 1);
    [roles[index], roles[target]] = [roles[target], roles[index]];
  }

  return entrants.map((entrant, index) => ({
    ...entrant,
    seatNumber: index + 1,
    role: roles[index],
    alive: true,
    antidoteAvailable: roles[index] === 'witch',
    poisonAvailable: roles[index] === 'witch',
    hunterShotAvailable: roles[index] === 'hunter',
  }));
}
