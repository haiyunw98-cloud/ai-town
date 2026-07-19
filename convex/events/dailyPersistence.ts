import { localizedDescriptions } from '../../data/worlds/lighthouse-town/characters';
import { residentEconomyProfiles } from '../../data/worlds/lighthouse-town/economy';
import type { DailyTheme } from './dailyTheme';
import { dailyEventTemplates, type DailyEventTemplate } from './dailyTemplates';
import { createDailyEventState, type DailyEventState } from './dailyStateMachine';

export type DailyRuntimeResident = Readonly<{
  residentId: string;
  displayName: string;
  identity: string;
}>;

export type PersistedDailyEvent = {
  worldId: string;
  dailyKey: string;
  templateId: string;
  eventName: string;
  announcement: string;
  venueMode: string;
  startedAt: number;
  endedAt?: number;
  archiveReason?: string;
  stageIndex: number;
  themeSource: string;
  status: 'running' | 'completed';
  phase: string;
  seed: number;
  phaseEndsAt: number;
  winnerId?: string;
  updatedAt: number;
};

export type PersistedDailyParticipant = DailyRuntimeResident & {
  score: number;
  shells: number;
  active: boolean;
  role: string;
  teamId: string;
  reachedFinal: boolean;
  quote?: string;
  choiceId?: string;
  decisionStage?: number;
};

export type PersistedDailyLog = {
  eventKey: string;
  sequence: number;
  stageIndex: number;
  kind: string;
  text: string;
  createdAt: number;
};

export type DailyEventDraft = {
  event: PersistedDailyEvent;
  participants: PersistedDailyParticipant[];
  logs: PersistedDailyLog[];
};

export function buildDailyEventDraft(args: {
  worldId: string;
  dayKey: string;
  template: DailyEventTemplate;
  theme: DailyTheme;
  residents: readonly DailyRuntimeResident[];
  seed: number;
  startedAt: number;
}): DailyEventDraft {
  validateConfiguredResidents(args.residents);
  const state = createDailyEventState(
    args.worldId,
    args.residents,
    args.template,
    args.dayKey,
    args.seed,
    args.startedAt,
  );
  const event: PersistedDailyEvent = {
    worldId: args.worldId,
    dailyKey: args.dayKey,
    templateId: args.template.id,
    eventName: args.theme.name,
    announcement: args.theme.announcement,
    venueMode: args.template.venue,
    startedAt: args.startedAt,
    stageIndex: 0,
    themeSource: args.theme.source,
    status: 'running',
    phase: args.template.stages[0].id,
    seed: args.seed,
    phaseEndsAt: args.startedAt + args.template.stages[0].endsAtMinute * 60_000,
    updatedAt: args.startedAt,
  };
  return {
    event,
    participants: state.participants.map((participant) => ({
      ...participant,
      identity: args.residents.find((resident) =>
        resident.residentId === participant.residentId)!.identity,
      shells: 0,
    })),
    logs: [{
      eventKey: `daily:${args.dayKey}:announcement`,
      sequence: 0,
      stageIndex: 0,
      kind: 'announcement',
      text: args.theme.announcement,
      createdAt: args.startedAt,
    }],
  };
}

export function restoreDailyEventState(
  event: PersistedDailyEvent,
  participants: readonly PersistedDailyParticipant[],
  logs: readonly PersistedDailyLog[],
): DailyEventState {
  if (!event.dailyKey || !event.templateId || event.stageIndex === undefined) {
    throw new Error('Legacy event cannot enter the daily event state machine.');
  }
  const template = dailyEventTemplates.find((candidate) => candidate.id === event.templateId);
  if (!template) throw new Error(`Unknown daily event template: ${event.templateId}`);
  if (participants.length !== 9) throw new Error('Daily event must persist exactly nine participants.');
  return {
    worldId: event.worldId,
    dayKey: event.dailyKey,
    seed: event.seed,
    template,
    stageIndex: event.stageIndex,
    status: event.status,
    participants: participants.map(({ residentId, displayName, teamId, score, active, role, reachedFinal }) => ({
      residentId,
      displayName,
      teamId: assertTeam(teamId),
      score,
      active,
      role: assertRole(role),
      reachedFinal,
    })),
    log: [...logs]
      .sort((left, right) => left.sequence - right.sequence)
      .map(({ sequence, stageIndex, text, createdAt }) => ({ sequence, stageIndex, text, createdAt })),
  };
}

export function serializeDailyEventState(
  previousEvent: PersistedDailyEvent,
  previousParticipants: readonly PersistedDailyParticipant[],
  state: DailyEventState,
  updatedAt: number,
): DailyEventDraft {
  if (state.dayKey !== previousEvent.dailyKey || state.worldId !== previousEvent.worldId) {
    throw new Error('Daily event persisted identity changed during advancement.');
  }
  const participantIdentity = new Map(
    previousParticipants.map((participant) => [participant.residentId, participant.identity]),
  );
  if (participantIdentity.size !== 9) {
    throw new Error('Daily event cannot advance without nine persisted identities.');
  }
  const completed = state.status === 'completed';
  const event: PersistedDailyEvent = {
    ...previousEvent,
    status: state.status,
    stageIndex: state.stageIndex,
    phase: state.template.stages[state.stageIndex].id,
    phaseEndsAt: completed
      ? updatedAt
      : previousEvent.startedAt + state.template.stages[state.stageIndex].endsAtMinute * 60_000,
    winnerId: state.participants.find((participant) => participant.role === 'winner')?.residentId,
    endedAt: completed ? updatedAt : undefined,
    archiveReason: completed ? 'completed' : undefined,
    updatedAt,
  };
  return {
    event,
    participants: state.participants.map((participant) => ({
      ...participant,
      identity: participantIdentity.get(participant.residentId) ?? (() => {
        throw new Error(`Missing persisted daily identity: ${participant.residentId}`);
      })(),
      shells: 0,
    })),
    logs: state.log.map((entry, index) => ({
      eventKey: index === 0
        ? `daily:${state.dayKey}:announcement`
        : completed && index === state.log.length - 1
          ? `daily:${state.dayKey}:return`
          : `daily:${state.dayKey}:stage:${entry.stageIndex}`,
      sequence: entry.sequence,
      stageIndex: entry.stageIndex,
      kind: index === 0 ? 'announcement' : completed && index === state.log.length - 1
        ? 'return'
        : 'stage',
      text: index === 0 ? previousEvent.announcement : entry.text,
      createdAt: entry.createdAt,
    })),
  };
}

function validateConfiguredResidents(residents: readonly DailyRuntimeResident[]) {
  if (residents.length !== 9) throw new Error('Daily event requires exactly nine residents.');
  const descriptions = localizedDescriptions('zh-CN');
  const identityByName = new Map(descriptions.map((description) => [description.name, description.identity]));
  const configuredNames = new Set(residentEconomyProfiles.map((profile) => profile.name));
  if (identityByName.size !== 9 || configuredNames.size !== 9) {
    throw new Error('Configured daily resident definitions are ambiguous.');
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const resident of residents) {
    if (seenIds.has(resident.residentId) || seenNames.has(resident.displayName)) {
      throw new Error('Daily event residents must map uniquely to configured residents.');
    }
    seenIds.add(resident.residentId);
    seenNames.add(resident.displayName);
    if (!configuredNames.has(resident.displayName)) {
      throw new Error(`Unknown configured resident: ${resident.displayName}`);
    }
    if (identityByName.get(resident.displayName) !== resident.identity) {
      throw new Error(`Configured resident identity mismatch: ${resident.displayName}`);
    }
  }
  if (seenNames.size !== configuredNames.size) {
    throw new Error('Daily event roster does not cover all configured residents.');
  }
}

function assertTeam(teamId: string): 'jade' | 'amber' {
  if (teamId !== 'jade' && teamId !== 'amber') throw new Error(`Invalid daily event team: ${teamId}`);
  return teamId;
}

function assertRole(role: string): 'competitor' | 'spectator' | 'winner' {
  if (role !== 'competitor' && role !== 'spectator' && role !== 'winner') {
    throw new Error(`Invalid daily event role: ${role}`);
  }
  return role;
}
