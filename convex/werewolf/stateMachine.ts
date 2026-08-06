import type {
  WerewolfAction,
  WerewolfCamp,
  WerewolfPhase,
  WerewolfRecordedAction,
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
  return state.actions.some((action) => action.kind === kind && action.actorId === actorId &&
    action.round === state.round && action.phase === state.phase);
}

function recordAction(state: WerewolfState, action: WerewolfAction): WerewolfRecordedAction {
  return { ...action, round: state.round, phase: state.phase };
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

function orderedLivingIds(seats: readonly WerewolfSeat[]) {
  return seats.filter((seat) => seat.alive)
    .sort((left, right) => left.seatNumber - right.seatNumber)
    .map((seat) => seat.playerId);
}

function startNextNight(state: WerewolfState, at: number): WerewolfState {
  return {
    ...state,
    round: state.round + 1,
    phase: 'night-wolves',
    pendingNightTargetId: undefined,
    pendingPoisonTargetId: undefined,
    pendingHunterId: undefined,
    hunterResumePhase: undefined,
    nightSaved: false,
    speakingOrder: [],
    runoffIds: [],
    updatedAt: at,
  };
}

export function evaluateWinner(seats: readonly WerewolfSeat[]): WerewolfCamp | undefined {
  const wolves = seats.filter((seat) => seat.alive && seat.role === 'werewolf').length;
  const good = seats.filter((seat) => seat.alive && seat.role !== 'werewolf').length;
  if (wolves === 0) return 'good';
  if (wolves >= good) return 'wolves';
  return undefined;
}

function finishOrContinue(
  state: WerewolfState,
  at: number,
  continuation: 'day-speaking' | 'night-wolves',
): WerewolfState {
  const winner = evaluateWinner(state.seats);
  if (winner) return { ...state, phase: 'completed', winner, updatedAt: at };
  if (continuation === 'night-wolves') return startNextNight(state, at);
  return {
    ...state,
    phase: 'day-speaking',
    speakingOrder: orderedLivingIds(state.seats),
    updatedAt: at,
  };
}

function eliminate(
  seats: readonly WerewolfSeat[],
  playerId: string,
  round: number,
  eliminatedBy: NonNullable<WerewolfSeat['eliminatedBy']>,
) {
  return seats.map((seat) => seat.playerId === playerId && seat.alive ? {
    ...seat,
    alive: false,
    eliminatedRound: round,
    eliminatedBy,
  } : { ...seat });
}

function tiedLeaders(votes: readonly Extract<WerewolfAction, { kind: 'day-vote' }>[]) {
  const counts = new Map<string, number>();
  for (const vote of votes) {
    if (vote.targetId) counts.set(vote.targetId, (counts.get(vote.targetId) ?? 0) + 1);
  }
  const maximum = Math.max(0, ...counts.values());
  return [...counts.entries()]
    .filter(([, count]) => count === maximum && maximum > 0)
    .map(([playerId]) => playerId)
    .sort();
}

export function applySystemStep(state: WerewolfState, at: number): WerewolfState {
  assertTimestamp(at, state.updatedAt);
  if (state.phase !== 'dawn') throw new Error('System step is outside the dawn phase.');

  let seats = state.seats.map((seat) => ({ ...seat }));
  if (state.pendingNightTargetId && !state.nightSaved) {
    seats = eliminate(seats, state.pendingNightTargetId, state.round, 'wolves');
  }
  if (state.pendingPoisonTargetId) {
    seats = eliminate(seats, state.pendingPoisonTargetId, state.round, 'witch');
  }
  let next: WerewolfState = { ...state, seats, updatedAt: at };
  const shootableHunter = seats.find((seat) =>
    seat.role === 'hunter' && !seat.alive && seat.hunterShotAvailable && seat.eliminatedBy !== 'witch',
  );
  if (shootableHunter) {
    return {
      ...next,
      phase: 'hunter',
      pendingHunterId: shootableHunter.playerId,
      hunterResumePhase: 'day-speaking',
    };
  }
  next = finishOrContinue(next, at, 'day-speaking');
  return next;
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
  const actor = state.phase === 'hunter'
    ? state.seats.find((seat) => seat.playerId === actorId)
    : actorSeat(state, actorId);
  if (!actor) return [];
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
  if (state.phase === 'day-voting' || state.phase === 'runoff-voting') {
    const allowed = state.phase === 'runoff-voting' ? new Set(state.runoffIds) : undefined;
    return state.seats
      .filter((seat) => seat.alive && seat.playerId !== actorId && (!allowed || allowed.has(seat.playerId)))
      .map((seat) => seat.playerId);
  }
  if (state.phase === 'hunter' && actor.playerId === state.pendingHunterId) {
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
  const actor = action.kind === 'hunter-shot'
    ? state.seats.find((seat) => seat.playerId === action.actorId)
    : actorSeat(state, action.actorId);
  if (!actor) throw new Error('Actor is not a seated player.');

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
    const actions = [...state.actions, recordAction(state, action)];
    const wolfVotes = actions.filter(
      (candidate): candidate is WerewolfRecordedAction & { kind: 'wolf-vote' } =>
        candidate.kind === 'wolf-vote' && candidate.round === state.round &&
        candidate.phase === state.phase,
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
      actions: [...state.actions, recordAction(state, action)],
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

  if (action.kind === 'speech') {
    if (state.phase !== 'day-speaking' && state.phase !== 'runoff-speaking') {
      throw new Error('Speech is outside its phase or turn.');
    }
    if (state.speakingOrder[0] !== action.actorId) throw new Error('Speech is outside the actor turn.');
    const limit = state.phase === 'runoff-speaking' ? 40 : 80;
    if (!action.text.trim() || [...action.text].length > limit) {
      throw new Error(`Speech must contain 1-${limit} characters.`);
    }
    const speakingOrder = state.speakingOrder.slice(1);
    const phase: WerewolfPhase = speakingOrder.length > 0 ? state.phase :
      state.phase === 'day-speaking' ? 'day-voting' : 'runoff-voting';
    return {
      ...state,
      actions: [...state.actions, recordAction(state, action)],
      speakingOrder,
      phase,
      updatedAt: action.at,
    };
  }

  if (action.kind === 'day-vote') {
    if (state.phase !== 'day-voting' && state.phase !== 'runoff-voting') {
      throw new Error('Day vote is outside its phase or turn.');
    }
    if (alreadyActed(state, action.actorId, action.kind)) {
      throw new Error('Player has already submitted a duplicate vote.');
    }
    if (action.targetId && !legalTargets(state, action.actorId).includes(action.targetId)) {
      throw new Error('Day vote has an illegal target.');
    }
    const recorded = recordAction(state, action);
    const actions = [...state.actions, recorded];
    const votes = actions.filter(
      (candidate): candidate is WerewolfRecordedAction & { kind: 'day-vote' } =>
        candidate.kind === 'day-vote' && candidate.round === state.round &&
        candidate.phase === state.phase,
    );
    if (votes.length < state.seats.filter((seat) => seat.alive).length) {
      return { ...state, actions, updatedAt: action.at };
    }
    const leaders = tiedLeaders(votes);
    if (state.phase === 'day-voting' && leaders.length > 1) {
      return {
        ...state,
        actions,
        phase: 'runoff-speaking',
        runoffIds: leaders,
        speakingOrder: leaders,
        updatedAt: action.at,
      };
    }
    if (leaders.length !== 1) {
      return startNextNight({ ...state, actions }, action.at);
    }
    const eliminatedId = leaders[0];
    const seats = eliminate(state.seats, eliminatedId, state.round, 'vote');
    const eliminated = seats.find((seat) => seat.playerId === eliminatedId)!;
    const next = { ...state, seats, actions, updatedAt: action.at };
    if (eliminated.role === 'hunter' && eliminated.hunterShotAvailable) {
      return {
        ...next,
        phase: 'hunter',
        pendingHunterId: eliminated.playerId,
        hunterResumePhase: 'night-wolves',
      };
    }
    return finishOrContinue(next, action.at, 'night-wolves');
  }

  if (action.kind === 'hunter-shot') {
    if (state.phase !== 'hunter' || actor.role !== 'hunter' ||
        actor.playerId !== state.pendingHunterId || !actor.hunterShotAvailable) {
      throw new Error('Hunter shot is outside its phase or turn.');
    }
    if (action.targetId && !legalTargets(state, action.actorId).includes(action.targetId)) {
      throw new Error('Hunter shot has an illegal target.');
    }
    let seats = state.seats.map((seat) => seat.playerId === actor.playerId ?
      { ...seat, hunterShotAvailable: false } : { ...seat });
    if (action.targetId) seats = eliminate(seats, action.targetId, state.round, 'hunter');
    const next = {
      ...state,
      seats,
      actions: [...state.actions, recordAction(state, action)],
      pendingHunterId: undefined,
      updatedAt: action.at,
    };
    return finishOrContinue(next, action.at, state.hunterResumePhase ?? 'night-wolves');
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
  if (action.save && state.round > 1 && state.pendingNightTargetId === actor.playerId) {
    throw new Error('The witch may only self-save on the first night.');
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
    actions: [...state.actions, recordAction(state, action)],
    phase: 'dawn',
    nightSaved: action.save,
    pendingPoisonTargetId: action.poisonTargetId,
    updatedAt: action.at,
  };
}
