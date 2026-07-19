import type {
  DailyEventChoice,
  DailyEventTemplate,
  DailyStageId,
} from './dailyTemplates';

export type DailyEventParticipant = {
  residentId: string;
  displayName: string;
  teamId: 'jade' | 'amber';
  score: number;
  active: boolean;
  role: 'competitor' | 'spectator' | 'winner';
  reachedFinal: boolean;
};

export type DailyEventLogEntry = {
  sequence: number;
  stageIndex: number;
  text: string;
  createdAt: number;
};

export type DailyEventState = {
  worldId: string;
  dayKey: string;
  seed: number;
  template: DailyEventTemplate;
  stageIndex: number;
  status: 'running' | 'completed';
  participants: DailyEventParticipant[];
  log: DailyEventLogEntry[];
};

export type DailyEventResident = Readonly<{
  residentId: string;
  displayName: string;
}>;

const DAILY_STAGE_IDS: readonly DailyStageId[] = [
  'assembly',
  'round-one',
  'round-two',
  'break',
  'semifinal',
  'final',
  'awards',
];
const DAILY_TARGET_ACTIVE = [9, 8, 6, 6, 4, 1, 1] as const;
const unsafeLogText = /死亡|死伤|伤亡|受伤|处决|流血|血腥|杀死|毙命/u;

export function createDailyEventState(
  worldId: string,
  residents: readonly DailyEventResident[],
  template: DailyEventTemplate,
  dayKey: string,
  seed: number,
  createdAt: number,
): DailyEventState {
  validateCreationInputs(worldId, residents, template, dayKey, seed, createdAt);

  const sortedIds = [...residents]
    .map((resident) => resident.residentId)
    .sort((left, right) => left.localeCompare(right));
  const teamByResident = new Map(
    sortedIds.map((residentId, index) => [
      residentId,
      index % 2 === 0 ? ('jade' as const) : ('amber' as const),
    ]),
  );
  const ownedTemplate = cloneTemplate(template);

  return {
    worldId,
    dayKey,
    seed,
    template: ownedTemplate,
    stageIndex: 0,
    status: 'running',
    participants: residents.map((resident) => ({
      residentId: resident.residentId,
      displayName: resident.displayName,
      teamId: teamByResident.get(resident.residentId)!,
      score: 0,
      active: true,
      role: 'competitor',
      reachedFinal: false,
    })),
    log: [
      {
        sequence: 0,
        stageIndex: 0,
        text: `${ownedTemplate.name}已公告，所有居民安全参赛。`,
        createdAt,
      },
    ],
  };
}

export function advanceDailyEventToStage(
  state: DailyEventState,
  targetStageIndex: number,
  createdAt: number,
  decisions: Readonly<Record<string, string>> = {},
): DailyEventState {
  validateTargetStage(targetStageIndex, state.template.stages.length);
  validateTimestamp(createdAt);
  validateState(state);

  const previousCreatedAt = state.log[state.log.length - 1].createdAt;
  if (createdAt < previousCreatedAt) {
    throw new RangeError('Daily event timestamp cannot move backward.');
  }
  if (targetStageIndex <= state.stageIndex || state.status === 'completed') return state;
  if (createdAt === previousCreatedAt) {
    throw new RangeError('Daily event progression timestamp must be later than the last log.');
  }

  const stageCount = targetStageIndex - state.stageIndex;
  let participants = state.participants.map((participant) => ({ ...participant }));
  const log = state.log.map((entry) => ({ ...entry }));

  for (let offset = 1; offset <= stageCount; offset += 1) {
    const stageIndex = state.stageIndex + offset;
    const stage = state.template.stages[stageIndex];
    const decisionChoices = offset === 1
      ? state.template.stages[state.stageIndex].choices
      : [];
    const ranked = participants
      .filter((participant) => participant.active)
      .map((participant) => ({
        residentId: participant.residentId,
        score:
          participant.score +
          stableScore(`${state.seed}:${state.template.id}:${stage.id}:${participant.residentId}`) +
          finiteChoiceBonus(decisionChoices, decisions[participant.residentId]),
      }))
      .sort((left, right) => right.score - left.score || left.residentId.localeCompare(right.residentId));
    const remainingIds = new Set(
      ranked.slice(0, stage.targetActive).map((participant) => participant.residentId),
    );
    const scoreByResident = new Map(
      ranked.map((participant) => [participant.residentId, participant.score]),
    );

    participants = participants.map((participant) => {
      const active = participant.active && remainingIds.has(participant.residentId);
      return {
        ...participant,
        score: scoreByResident.get(participant.residentId) ?? participant.score,
        active,
        role: active ? ('competitor' as const) : ('spectator' as const),
        reachedFinal: participant.reachedFinal || (stageIndex === 4 && active),
      };
    });

    log.push({
      sequence: log.length,
      stageIndex,
      text: `${stage.label}完成，退出者转入观众席。`,
      createdAt:
        previousCreatedAt + ((createdAt - previousCreatedAt) * offset) / stageCount,
    });
  }

  const completed = targetStageIndex === state.template.stages.length - 1;
  if (completed) {
    const winner = participants
      .filter((participant) => participant.active)
      .sort(compareParticipants)[0];
    if (!winner) throw new Error('Daily event cannot complete without one active winner.');
    participants = participants.map((participant) =>
      participant.residentId === winner.residentId
        ? { ...participant, active: true, role: 'winner' as const }
        : { ...participant, active: false, role: 'spectator' as const },
    );
    log.push({
      sequence: log.length,
      stageIndex: targetStageIndex,
      text: `${winner.displayName}获得冠军，居民开始安全返程。`,
      createdAt,
    });
  }

  return {
    ...state,
    stageIndex: targetStageIndex,
    status: completed ? 'completed' : 'running',
    participants,
    log,
  };
}

function validateCreationInputs(
  worldId: string,
  residents: readonly DailyEventResident[],
  template: DailyEventTemplate,
  dayKey: string,
  seed: number,
  createdAt: number,
): void {
  if (!worldId.trim() || !/^\d{4}-\d{2}-\d{2}$/u.test(dayKey)) {
    throw new TypeError('Daily event world ID and day key must be valid non-empty values.');
  }
  if (!Number.isSafeInteger(seed)) throw new RangeError('Daily event seed must be a safe integer.');
  validateTimestamp(createdAt);
  validateTemplate(template);
  if (residents.length !== 9) throw new RangeError('Daily events require exactly nine residents.');
  if (
    residents.some(
      (resident) =>
        !resident.residentId.trim() ||
        !resident.displayName.trim() ||
        unsafeLogText.test(resident.displayName),
    )
  ) {
    throw new TypeError('Daily event residents require safe, non-empty identities.');
  }
  if (new Set(residents.map((resident) => resident.residentId)).size !== residents.length) {
    throw new TypeError('Daily event resident IDs must be unique.');
  }
}

function validateState(state: DailyEventState): void {
  validateTemplate(state.template);
  if (!Number.isInteger(state.stageIndex) || state.stageIndex < 0 || state.stageIndex > 6) {
    throw new RangeError('Daily event state has an invalid stage index.');
  }
  if (state.participants.length !== 9) {
    throw new RangeError('Daily event state must retain exactly nine participants.');
  }
  if (new Set(state.participants.map((participant) => participant.residentId)).size !== 9) {
    throw new TypeError('Daily event state participant IDs must remain unique.');
  }
  validateParticipantRoles(state);
  if (state.log.length === 0) {
    throw new TypeError('Daily event state must contain factual audit logs.');
  }
  const coveredStages = new Set<number>();
  for (let index = 0; index < state.log.length; index += 1) {
    const entry = state.log[index];
    validateTimestamp(entry.createdAt);
    if (!entry.text.trim() || unsafeLogText.test(entry.text)) {
      throw new TypeError('Daily event audit log text must be non-empty and safe.');
    }
    if (
      !Number.isInteger(entry.stageIndex) ||
      entry.stageIndex < 0 ||
      entry.stageIndex > 6 ||
      entry.stageIndex > state.stageIndex
    ) {
      throw new TypeError('Daily event audit log stage is outside the current state.');
    }
    if (entry.sequence !== index) {
      throw new TypeError('Daily event audit log sequence must be continuous.');
    }
    if (
      index > 0 &&
      (entry.createdAt < state.log[index - 1].createdAt ||
        entry.stageIndex < state.log[index - 1].stageIndex)
    ) {
      throw new TypeError('Daily event log stages and timestamps must be monotonic.');
    }
    coveredStages.add(entry.stageIndex);
  }
  for (let stageIndex = 0; stageIndex <= state.stageIndex; stageIndex += 1) {
    if (!coveredStages.has(stageIndex)) {
      throw new TypeError('Daily event audit log must cover every completed stage.');
    }
  }
}

function validateParticipantRoles(state: DailyEventState): void {
  const winners = state.participants.filter((participant) => participant.role === 'winner');
  const competitors = state.participants.filter(
    (participant) => participant.role === 'competitor',
  );
  const spectators = state.participants.filter(
    (participant) => participant.role === 'spectator',
  );
  if (winners.length + competitors.length + spectators.length !== state.participants.length) {
    throw new TypeError('Daily event state contains an unknown participant role.');
  }

  if (state.status === 'running') {
    const targetActive = DAILY_TARGET_ACTIVE[state.stageIndex];
    if (
      state.stageIndex > 5 ||
      winners.length !== 0 ||
      competitors.length !== targetActive ||
      spectators.length !== state.participants.length - targetActive ||
      competitors.some((participant) => !participant.active) ||
      spectators.some((participant) => participant.active)
    ) {
      throw new TypeError(
        'Running daily event state must match the stage competitor target.',
      );
    }
    return;
  }

  if (state.status === 'completed') {
    if (
      state.stageIndex !== 6 ||
      winners.length !== 1 ||
      !winners[0].active ||
      competitors.length !== 0 ||
      spectators.length !== 8 ||
      spectators.some((participant) => participant.active)
    ) {
      throw new TypeError('Completed daily event state requires one winner and eight spectators.');
    }
    return;
  }

  throw new TypeError('Daily event state has an invalid status.');
}

function validateTemplate(template: DailyEventTemplate): void {
  if (
    !template.name.trim() ||
    unsafeLogText.test(template.name) ||
    template.stages.length !== DAILY_STAGE_IDS.length
  ) {
    throw new TypeError('Daily event template must be a safe seven-stage template.');
  }
  for (let index = 0; index < DAILY_STAGE_IDS.length; index += 1) {
    const stage = template.stages[index];
    if (
      stage.id !== DAILY_STAGE_IDS[index] ||
      stage.targetActive !== DAILY_TARGET_ACTIVE[index] ||
      !stage.label.trim() ||
      unsafeLogText.test(stage.label) ||
      stage.choices.length < 2 ||
      new Set(stage.choices.map((choice) => choice.id)).size !== stage.choices.length
    ) {
      throw new TypeError('Daily event template stage contract is invalid.');
    }
  }
}

function validateTargetStage(targetStageIndex: number, stageCount: number): void {
  if (
    !Number.isInteger(targetStageIndex) ||
    targetStageIndex < 0 ||
    targetStageIndex >= stageCount
  ) {
    throw new RangeError('Daily event target stage is outside the seven-stage contract.');
  }
}

function validateTimestamp(timestamp: number): void {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new RangeError('Daily event timestamp must be a finite non-negative number.');
  }
}

function finiteChoiceBonus(
  choices: readonly DailyEventChoice[],
  selectedChoiceId: string | undefined,
): number {
  const choiceIndex = choices.findIndex((choice) => choice.id === selectedChoiceId);
  return choiceIndex < 0 ? 0 : choiceIndex + 1;
}

function stableScore(key: string): number {
  let hash = 2166136261;
  for (const character of key) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return (hash >>> 0) % 100;
}

function compareParticipants(
  left: DailyEventParticipant,
  right: DailyEventParticipant,
): number {
  return right.score - left.score || left.residentId.localeCompare(right.residentId);
}

function cloneTemplate(template: DailyEventTemplate): DailyEventTemplate {
  return {
    ...template,
    stages: template.stages.map((stage) => ({
      ...stage,
      checkpoints: [...stage.checkpoints],
      props: [...stage.props],
      choices: stage.choices.map((choice) => ({ ...choice })),
    })),
  };
}
