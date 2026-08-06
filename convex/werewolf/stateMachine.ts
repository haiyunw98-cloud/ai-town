import type {
  WerewolfAction,
  WerewolfRole,
  WerewolfSeat,
  WerewolfState,
} from './types';

function assertTimestamp(at: number, previous?: number) {
  if (!Number.isSafeInteger(at) || (previous !== undefined && at <= previous)) {
    throw new Error('Werewolf actions require a newer integer timestamp.');
  }
}

function assertSeatSet(seats: readonly WerewolfSeat[]) {
  if (seats.length !== 9 || new Set(seats.map((seat) => seat.playerId)).size !== 9) {
    throw new Error('Werewolf state requires nine unique seats.');
  }
  const count = (role: WerewolfRole) => seats.filter((seat) => seat.role === role).length;
  if (count('werewolf') !== 3 || count('villager') !== 3 ||
      count('seer') !== 1 || count('witch') !== 1 || count('hunter') !== 1) {
    throw new Error('Werewolf state has an invalid role distribution.');
  }
}

function livingRole(state: WerewolfState, role: WerewolfRole) {
  return state.seats.filter((seat) => seat.alive && seat.role === role);
}

function actorSeat(state: WerewolfState, actorId: string) {
  const seat = state.seats.find((candidate) => candidate.playerId === actorId);
  if (!seat || !seat.alive) throw new Error('Actor is not an alive player.');
  return seat;
}

function alreadyActed(state: WerewolfState, actorId: string, kind: WerewolfAction['kind']) {
  return state.actions.some((action) => action.kind === kind && action.actorId === actorId);
}

function nextNightPhase(state: WerewolfState, after: 'wolves' | 'seer') {
  if (after === 'wolves' && livingRole(state, 'seer').length > 0) return 'night-seer' as const;
  if (livingRole(state, 'witch').length > 0) return 'night-witch' as const;
  return 'dawn' as const;
}

function voteWinner(state: WerewolfState, votes: Extract<WerewolfAction, { kind: 'wolf-vote' }>[]) {
  const counts = new Map<string, number>();
  for (const vote of votes) counts.set(vote.targetId, (counts.get(vote.targetId) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => {
    const countDifference = right[1] - left[1];
    if (countDifference !== 0) return countDifference;
    const leftSeat = state.seats.find((seat) => seat.playerId === left[0])?.seatNumber ?? 0;
    const rightSeat = state.seats.find((seat) => seat.playerId === right[0])?.seatNumber ?? 0;
    const direction = state.seed % 2 === 0 ? 1 : -1;
    return direction * (leftSeat - rightSeat);
  })[0]?.[0];
}

export function beginWerewolfGame(
  seats: readonly WerewolfSeat[],
  seed: number,
  at: number,
): WerewolfState {
  assertSeatSet(seats);
  if (!Number.isSafeInteger(seed)) throw new Error('Werewolf seed must be an integer.');
  assertTimestamp(at);
  return {
    seed,
    round: 1,
    phase: 'night-wolves',
    seats: seats.map((seat) => ({ ...seat })),
    actions: [],
    nightSaved: false,
    speakingOrder: [],
    runoffIds: [],
    privateResults: {},
    updatedAt: at,
  };
}

export function legalTargets(state: WerewolfState, actorId: string): string[] {
  const actor = actorSeat(state, actorId);
  if (state.phase === 'night-wolves') {
    if (actor.role !== 'werewolf') return [];
    return state.seats
      .filter((seat) => seat.alive && seat.role !== 'werewolf')
      .map((seat) => seat.playerId);
  }
  if (state.phase === 'night-seer') {
    if (actor.role !== 'seer') return [];
    return state.seats
      .filter((seat) => seat.alive && seat.playerId !== actorId)
      .map((seat) => seat.playerId);
  }
  if (state.phase === 'night-witch') {
    if (actor.role !== 'witch') return [];
    return state.seats
      .filter((seat) => seat.alive && seat.playerId !== actorId)
      .map((seat) => seat.playerId);
  }
  return [];
}

export function applyWerewolfAction(
  state: WerewolfState,
  action: WerewolfAction,
): WerewolfState {
  assertTimestamp(action.at, state.updatedAt);
  const actor = actorSeat(state, action.actorId);

  if (action.kind === 'wolf-vote') {
    if (state.phase !== 'night-wolves' || actor.role !== 'werewolf') {
      throw new Error('Wolf vote is outside its phase or turn.');
    }
    if (alreadyActed(state, action.actorId, action.kind)) {
      throw new Error('Wolf has already submitted a duplicate vote.');
    }
    if (!legalTargets(state, action.actorId).includes(action.targetId)) {
      throw new Error('Wolf vote has an illegal target.');
    }
    const actions = [...state.actions, action];
    const wolfVotes = actions.filter(
      (candidate): candidate is Extract<WerewolfAction, { kind: 'wolf-vote' }> =>
        candidate.kind === 'wolf-vote',
    );
    const allVoted = wolfVotes.length === livingRole(state, 'werewolf').length;
    return {
      ...state,
      actions,
      phase: allVoted ? nextNightPhase(state, 'wolves') : state.phase,
      pendingNightTargetId: allVoted ? voteWinner(state, wolfVotes) : state.pendingNightTargetId,
      updatedAt: action.at,
    };
  }

  if (action.kind === 'seer-check') {
    if (state.phase !== 'night-seer' || actor.role !== 'seer') {
      throw new Error('Seer check is outside its phase or turn.');
    }
    if (alreadyActed(state, action.actorId, action.kind)) {
      throw new Error('Seer has already submitted a duplicate check.');
    }
    if (!legalTargets(state, action.actorId).includes(action.targetId)) {
      throw new Error('Seer check has an illegal target.');
    }
    const target = state.seats.find((seat) => seat.playerId === action.targetId)!;
    return {
      ...state,
      actions: [...state.actions, action],
      phase: nextNightPhase(state, 'seer'),
      privateResults: {
        ...state.privateResults,
        [action.actorId]: [
          ...(state.privateResults[action.actorId] ?? []),
          { targetId: action.targetId, camp: target.role === 'werewolf' ? 'wolves' : 'good' },
        ],
      },
      updatedAt: action.at,
    };
  }

  if (state.phase !== 'night-witch' || actor.role !== 'witch') {
    throw new Error('Witch action is outside its phase or turn.');
  }
  if (alreadyActed(state, action.actorId, action.kind)) {
    throw new Error('Witch has already submitted a duplicate action.');
  }
  if (action.save && action.poisonTargetId) {
    throw new Error('The witch cannot use both medicines in the same night.');
  }
  if (action.save && (!actor.antidoteAvailable || !state.pendingNightTargetId)) {
    throw new Error('The witch cannot use the antidote now.');
  }
  if (action.poisonTargetId &&
      (!actor.poisonAvailable || !legalTargets(state, action.actorId).includes(action.poisonTargetId))) {
    throw new Error('The witch cannot poison that target.');
  }
  const seats = state.seats.map((seat) => seat.playerId === action.actorId ? {
    ...seat,
    antidoteAvailable: action.save ? false : seat.antidoteAvailable,
    poisonAvailable: action.poisonTargetId ? false : seat.poisonAvailable,
  } : { ...seat });
  return {
    ...state,
    seats,
    actions: [...state.actions, action],
    phase: 'dawn',
    nightSaved: action.save,
    pendingPoisonTargetId: action.poisonTargetId,
    updatedAt: action.at,
  };
}
