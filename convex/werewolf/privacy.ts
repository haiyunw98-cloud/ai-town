import { legalTargets } from './stateMachine';
import type {
  WerewolfAction,
  WerewolfCamp,
  WerewolfPhase,
  WerewolfRecordedAction,
  WerewolfRole,
  WerewolfSeat,
  WerewolfState,
} from './types';

type PublicSeat = Pick<
  WerewolfSeat,
  'playerId' | 'displayName' | 'seatNumber' | 'alive' | 'eliminatedRound' | 'eliminatedBy'
> & { role?: WerewolfRole };

export type WerewolfViewerState = {
  viewerId?: string;
  phase: WerewolfPhase;
  round: number;
  seats: PublicSeat[];
  publicActions: WerewolfAction[];
  privateRole?: WerewolfRole;
  knownWolfIds?: string[];
  seerResults?: Array<{ targetId: string; camp: WerewolfCamp }>;
  witchNoticeTargetId?: string;
  antidoteAvailable?: boolean;
  poisonAvailable?: boolean;
  legalTargets: string[];
  pendingHumanAction?: WerewolfAction['kind'];
  speakingPlayerId?: string;
  runoffIds: string[];
  winner?: WerewolfCamp | 'draw';
  observerSecrets?: {
    roles: Record<string, WerewolfRole>;
    nightActions: WerewolfRecordedAction[];
    pendingNightTargetId?: string;
    pendingPoisonTargetId?: string;
  };
};

function publicAction(state: WerewolfState, action: WerewolfState['actions'][number]) {
  if (action.kind === 'speech' || action.kind === 'hunter-shot') return true;
  if (action.kind !== 'day-vote') return false;
  return state.phase === 'completed' || action.round !== state.round || action.phase !== state.phase;
}

function pendingAction(state: WerewolfState, viewer: WerewolfSeat) {
  const hasActed = (kind: WerewolfAction['kind']) => state.actions.some((action) =>
    action.kind === kind && action.actorId === viewer.playerId &&
    action.round === state.round && action.phase === state.phase,
  );
  if (state.phase === 'night-wolves' && viewer.role === 'werewolf' && !hasActed('wolf-vote')) {
    return 'wolf-vote' as const;
  }
  if (state.phase === 'night-seer' && viewer.role === 'seer' && !hasActed('seer-check')) {
    return 'seer-check' as const;
  }
  if (state.phase === 'night-witch' && viewer.role === 'witch' && !hasActed('witch-use')) {
    return 'witch-use' as const;
  }
  if ((state.phase === 'day-speaking' || state.phase === 'runoff-speaking') &&
      state.speakingOrder[0] === viewer.playerId) {
    return 'speech' as const;
  }
  if ((state.phase === 'day-voting' || state.phase === 'runoff-voting') &&
      viewer.alive && !hasActed('day-vote')) {
    return 'day-vote' as const;
  }
  if (state.phase === 'hunter' && state.pendingHunterId === viewer.playerId) {
    return 'hunter-shot' as const;
  }
  return undefined;
}

export function buildWerewolfViewerState(
  state: WerewolfState,
  viewerId?: string,
  mode: 'observe' | 'play' | 'public' = 'public',
): WerewolfViewerState {
  const viewer = viewerId
    ? state.seats.find((seat) => seat.playerId === viewerId)
    : undefined;
  const completed = state.phase === 'completed';
  const seats = state.seats.map((seat): PublicSeat => ({
    playerId: seat.playerId,
    displayName: seat.displayName,
    seatNumber: seat.seatNumber,
    alive: seat.alive,
    eliminatedRound: seat.eliminatedRound,
    eliminatedBy: seat.eliminatedBy,
    ...(completed ? { role: seat.role } : {}),
  }));
  const result: WerewolfViewerState = {
    viewerId,
    phase: state.phase,
    round: state.round,
    seats,
    publicActions: state.actions.filter((action) => publicAction(state, action)),
    legalTargets: viewer ? legalTargets(state, viewer.playerId) : [],
    pendingHumanAction: viewer ? pendingAction(state, viewer) : undefined,
    speakingPlayerId: state.speakingOrder[0],
    runoffIds: [...state.runoffIds],
    winner: state.winner,
  };
  if (!viewer) {
    if (mode === 'observe') {
      result.observerSecrets = {
        roles: Object.fromEntries(state.seats.map((seat) => [seat.playerId, seat.role])),
        nightActions: state.actions.filter((action) => action.phase.startsWith('night-')),
        pendingNightTargetId: state.pendingNightTargetId,
        pendingPoisonTargetId: state.pendingPoisonTargetId,
      };
    }
    return result;
  }

  result.privateRole = viewer.role;
  if (viewer.role === 'werewolf') {
    result.knownWolfIds = state.seats
      .filter((seat) => seat.alive && seat.role === 'werewolf')
      .map((seat) => seat.playerId);
  }
  if (viewer.role === 'seer') {
    result.seerResults = [...(state.privateResults[viewer.playerId] ?? [])];
  }
  if (viewer.role === 'witch') {
    result.antidoteAvailable = viewer.antidoteAvailable;
    result.poisonAvailable = viewer.poisonAvailable;
    if (state.phase === 'night-witch') result.witchNoticeTargetId = state.pendingNightTargetId;
  }
  return result;
}
