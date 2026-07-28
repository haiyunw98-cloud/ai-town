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
  startedAt?: number;
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

export function buildMissedDailyEventDraft(
  worldId: string,
  dayKey: string,
  worldStatus: 'running' | 'inactive' | 'stoppedByDeveloper',
  now: number,
): DailyEventDraft {
  const archiveReason = worldStatus === 'running' ? 'missed-window' : 'world-paused';
  const text = archiveReason === 'world-paused'
    ? '当日活动因小镇暂停而未举行，没有参赛者或奖金。'
    : '当日活动窗口已经错过，没有参赛者或奖金。';
  return {
    event: {
      worldId,
      dailyKey: dayKey,
      templateId: 'none',
      eventName: '当日活动未举行',
      announcement: text,
      venueMode: 'main-town',
      status: 'completed',
      phase: 'missed',
      seed: stableSeed(dayKey),
      phaseEndsAt: now,
      endedAt: now,
      archiveReason,
      stageIndex: 0,
      themeSource: 'fallback',
      updatedAt: now,
    },
    participants: [],
    logs: [{
      eventKey: `daily:${dayKey}:missed`,
      sequence: 0,
      stageIndex: 0,
      kind: 'missed',
      text,
      createdAt: now,
    }],
  };
}

export function archiveInterruptedDailyDraft(
  draft: DailyEventDraft,
  now: number,
): DailyEventDraft {
  if (draft.event.status === 'completed') return draft;
  if (
    !draft.event.dailyKey || draft.participants.length !== 9
    || !Number.isFinite(now) || now < draft.event.updatedAt
  ) {
    throw new Error('Running cross-day event cannot be archived safely.');
  }
  const eventKey = `daily:${draft.event.dailyKey}:interrupted-cross-day`;
  if (draft.logs.some((entry) => entry.eventKey === eventKey)) {
    throw new Error(`Cross-day archive log collision: ${eventKey}`);
  }
  return {
    event: {
      ...draft.event,
      status: 'completed',
      phase: 'interrupted',
      phaseEndsAt: now,
      endedAt: now,
      archiveReason: 'interrupted-cross-day',
      winnerId: undefined,
      updatedAt: now,
    },
    participants: draft.participants.map((participant) => ({
      ...participant,
      active: false,
      role: 'spectator',
    })),
    logs: [
      ...draft.logs,
      {
        eventKey,
        sequence: draft.logs.length,
        stageIndex: draft.event.stageIndex,
        kind: 'interrupted-cross-day',
        text: '昨日活动因跨日中断而安全结束，没有冠军或奖金，居民恢复普通生活。',
        createdAt: now,
      },
    ],
  };
}

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
    logs: [
      {
        eventKey: `daily:${args.dayKey}:announcement`,
        sequence: 0,
        stageIndex: 0,
        kind: 'announcement',
        text: args.theme.announcement,
        createdAt: args.startedAt,
      },
      {
        eventKey: `daily:${args.dayKey}:briefing`,
        sequence: 1,
        stageIndex: 0,
        kind: 'briefing',
        text: formatOpeningBriefing(args.template, state.participants),
        createdAt: args.startedAt,
      },
    ],
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
  if (previousEvent.startedAt === undefined) {
    throw new Error('Running daily event is missing startedAt.');
  }
  const participantIdentity = new Map(
    previousParticipants.map((participant) => [participant.residentId, participant.identity]),
  );
  const previousParticipantById = new Map(
    previousParticipants.map((participant) => [participant.residentId, participant]),
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
      quote: previousParticipantById.get(participant.residentId)?.quote,
      choiceId: previousParticipantById.get(participant.residentId)?.choiceId,
      decisionStage: previousParticipantById.get(participant.residentId)?.decisionStage,
    })),
    logs: state.log.map((entry, index) => ({
      eventKey: index === 0
        ? `daily:${state.dayKey}:announcement`
        : index === 1 && entry.stageIndex === 0
          ? `daily:${state.dayKey}:briefing`
          : completed && index === state.log.length - 1
            ? `daily:${state.dayKey}:return`
            : `daily:${state.dayKey}:stage:${entry.stageIndex}`,
      sequence: entry.sequence,
      stageIndex: entry.stageIndex,
      kind: index === 0 ? 'announcement' : index === 1 && entry.stageIndex === 0
        ? 'briefing'
        : completed && index === state.log.length - 1
          ? 'return'
          : 'stage',
      text: index === 0 ? previousEvent.announcement : entry.text,
      createdAt: entry.createdAt,
    })),
  };
}

function formatOpeningBriefing(
  template: DailyEventTemplate,
  participants: readonly { displayName: string; teamId: 'jade' | 'amber' }[],
) {
  const jade = participants
    .filter((participant) => participant.teamId === 'jade')
    .map((participant) => participant.displayName);
  const amber = participants
    .filter((participant) => participant.teamId === 'amber')
    .map((participant) => participant.displayName);
  return `活动说明：首关“${template.stages[0].label}”，随后依次完成${template.stages
    .slice(1)
    .map((stage) => `“${stage.label}”`)
    .join('、')}。参赛名单：${participants.map((participant) => participant.displayName).join('、')}。青队：${jade.join('、')}；琥珀队：${amber.join('、')}。`;
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

function stableSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}
