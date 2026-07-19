import { dailyEventTemplates } from '../../convex/events/dailyTemplates';
import { dailyEventCheckpointById } from '../../data/worlds/lighthouse-town/map';

export type EventMapSnapshot = {
  event: {
    dailyKey: string;
    name: string;
    status: string;
    phase: string;
    stageIndex: number;
    templateId?: string;
    venueMode?: string;
    winnerId?: string;
  };
  participants: Array<{
    residentId: string;
    displayName: string;
    active: boolean;
    role: string;
    teamId?: string;
    rank?: number;
  }>;
} | null | undefined;

export function buildEventOverlayState(snapshot: EventMapSnapshot) {
  const template = dailyEventTemplates.find(
    (entry) => entry.id === snapshot?.event.templateId,
  );
  const stage = template?.stages[snapshot?.event.stageIndex ?? -1];
  const activeCheckpoint = stage?.checkpoints[0]
    ? dailyEventCheckpointById(stage.checkpoints[0])
    : undefined;
  return {
    stage,
    activeCheckpoint,
    isIslandEvent: snapshot?.event.venueMode === 'trial-island',
    spectatorCount: snapshot?.participants.filter((entry) => !entry.active).length ?? 0,
    teamCount: new Set(
      snapshot?.participants.flatMap((entry) =>
        entry.active && entry.teamId ? [entry.teamId] : []) ?? [],
    ).size,
    winner: snapshot?.participants.find(
      (entry) => entry.residentId === snapshot.event.winnerId || entry.rank === 1,
    ),
  };
}
