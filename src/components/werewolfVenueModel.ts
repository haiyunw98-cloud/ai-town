import type { WerewolfRecordedAction } from '../../convex/werewolf/types';
import type { WerewolfPanelState } from './werewolfView';

export type VenueSeatPoint = { seatNumber: number; x: number; y: number };

export function venueSeatPositions(count = 9): VenueSeatPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    return {
      seatNumber: index + 1,
      x: 50 + Math.cos(angle) * 41,
      y: 50 + Math.sin(angle) * 38,
    };
  });
}

export type VenueActionCue = {
  kind: 'sleeping' | 'wolf-target' | 'seer-check' | 'witch-action' | 'speaker' | 'vote';
  actorIds: string[];
  targetId?: string;
  label: string;
};

function currentNightActions(state: Partial<WerewolfPanelState>): WerewolfRecordedAction[] {
  return (state.observerSecrets?.nightActions ?? []).filter((action) =>
    action.round === state.round && action.phase === state.phase,
  );
}

export function buildVenueActionCue(state: Partial<WerewolfPanelState>): VenueActionCue {
  const actions = currentNightActions(state);
  if (state.phase === 'night-wolves') {
    if (!state.observerSecrets) {
      return { kind: 'sleeping', actorIds: [], label: '夜间行动进行中' };
    }
    const wolfActions = actions.filter((action) => action.kind === 'wolf-vote');
    const lastTargetId = wolfActions.reduce<string | undefined>((targetId, action) =>
      action.kind === 'wolf-vote' ? action.targetId : targetId, undefined);
    return {
      kind: 'wolf-target',
      actorIds: [...new Set(wolfActions.map((action) => action.actorId))],
      targetId: state.observerSecrets.pendingNightTargetId ?? lastTargetId,
      label: '狼人正在选择目标',
    };
  }
  if (state.phase === 'night-seer') {
    const action = actions.find((entry) => entry.kind === 'seer-check');
    return {
      kind: 'seer-check',
      actorIds: action ? [action.actorId] : [],
      targetId: action?.kind === 'seer-check' ? action.targetId : undefined,
      label: '预言家正在查验',
    };
  }
  if (state.phase === 'night-witch') {
    const action = actions.find((entry) => entry.kind === 'witch-use');
    return {
      kind: 'witch-action',
      actorIds: action ? [action.actorId] : [],
      targetId: state.observerSecrets?.pendingPoisonTargetId,
      label: '女巫正在决定是否用药',
    };
  }
  if (state.phase === 'day-speaking' || state.phase === 'runoff-speaking') {
    return {
      kind: 'speaker',
      actorIds: state.speakingPlayerId ? [state.speakingPlayerId] : [],
      label: '居民依次发言',
    };
  }
  return { kind: 'vote', actorIds: [], label: '居民正在投票' };
}
