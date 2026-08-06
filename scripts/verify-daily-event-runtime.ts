import { pathToFileURL } from 'node:url';
import { localizedDescriptions } from '../data/worlds/lighthouse-town/characters';
import {
  buildDailyReturnMovementCommands,
  buildDailyStageMovementCommands,
} from '../convex/events';
import {
  buildDailyEventDraft,
  restoreDailyEventState,
  serializeDailyEventState,
} from '../convex/events/dailyPersistence';
import { advanceDailyEventToStage } from '../convex/events/dailyStateMachine';
import { dailyEventTemplates } from '../convex/events/dailyTemplates';
import { eventReward } from '../convex/townEconomyRules';

export function verifyDailyEventRuntime() {
  const dayKey = '2026-07-19';
  const startedAt = Date.parse(`${dayKey}T04:00:00.000Z`);
  const template = dailyEventTemplates.find((entry) => entry.id === 'safe-survival');
  if (!template) throw new Error('Safe trial-island template is missing');
  const residents = localizedDescriptions('zh-CN').map((description, index) => ({
    residentId: `runtime:p:${index}`,
    displayName: description.name,
    identity: description.identity,
  }));
  const draft = buildDailyEventDraft({
    worldId: 'runtime-verification-world',
    dayKey,
    template,
    theme: {
      name: template.name,
      announcement: '九位居民参加安全协作活动，退出者进入观众席。',
      source: 'fallback',
    },
    residents,
    seed: 20260719,
    startedAt,
  });

  let state = restoreDailyEventState(draft.event, draft.participants, draft.logs);
  const stageResults: Array<{
    stage: string;
    active: number;
    spectators: number;
    movementCommands: number;
    transfers: number;
    ferryMovements: number;
  }> = [];
  const assemblyCommands = buildDailyStageMovementCommands(
    template,
    0,
    draft.participants,
    startedAt,
    draft.event.phaseEndsAt,
    false,
  );
  stageResults.push({
    stage: template.stages[0].id,
    active: 9,
    spectators: 0,
    movementCommands: assemblyCommands.length,
    transfers: assemblyCommands.filter((command) => command.kind === 'transfer').length,
    ferryMovements: assemblyCommands.filter((command) =>
      command.description.includes('乘坐内河渡船')).length,
  });

  let persisted = draft;
  for (let stageIndex = 1; stageIndex < template.stages.length; stageIndex += 1) {
    const stageAt = startedAt + template.stages[stageIndex - 1].endsAtMinute * 60_000;
    state = advanceDailyEventToStage(state, stageIndex, stageAt);
    persisted = serializeDailyEventState(
      persisted.event,
      persisted.participants,
      state,
      stageAt,
    );
    const commands = buildDailyStageMovementCommands(
      template,
      stageIndex,
      persisted.participants,
      stageAt,
      persisted.event.phaseEndsAt,
      stageIndex === 1,
    );
    stageResults.push({
      stage: template.stages[stageIndex].id,
      active: persisted.participants.filter((participant) => participant.active).length,
      spectators: persisted.participants.filter(
        (participant) => participant.role === 'spectator',
      ).length,
      movementCommands: commands.length,
      transfers: commands.filter((command) => command.kind === 'transfer').length,
      ferryMovements: commands.filter((command) =>
        command.description.includes('乘坐内河渡船')).length,
    });
  }

  const winner = persisted.participants.find((participant) => participant.role === 'winner');
  if (!winner || persisted.event.status !== 'completed') {
    throw new Error('Event rehearsal did not produce one completed winner');
  }
  const returnAt = startedAt + 120 * 60_000;
  const returnCommands = buildDailyReturnMovementCommands(
    'trial-island',
    persisted.participants,
    returnAt,
  );
  const rewardRows = persisted.participants.flatMap((participant) => {
    const rows = [{
      key: `event:runtime:${participant.residentId}:participation`,
      residentId: participant.residentId,
      amount: 10,
    }];
    if (participant.reachedFinal) {
      rows.push({
        key: `event:runtime:${participant.residentId}:finalist`,
        residentId: participant.residentId,
        amount: 20,
      });
    }
    if (participant.role === 'winner') {
      rows.push({
        key: `event:runtime:${participant.residentId}:champion`,
        residentId: participant.residentId,
        amount: 50,
      });
    }
    return rows;
  });
  const rewardByResident = new Map<string, number>();
  for (const row of rewardRows) {
    rewardByResident.set(
      row.residentId,
      (rewardByResident.get(row.residentId) ?? 0) + row.amount,
    );
  }
  for (const participant of persisted.participants) {
    const expected = eventReward({
      participated: true,
      finalist: participant.reachedFinal,
      champion: participant.role === 'winner',
    });
    if (rewardByResident.get(participant.residentId) !== expected) {
      throw new Error(`Reward mismatch for ${participant.residentId}`);
    }
  }

  const unsafeText = /死亡|死伤|伤亡|受伤|处决|流血|血腥|杀死|毙命/u;
  const checks = {
    nineResidents: persisted.participants.length === 9,
    sevenStages: stageResults.length === 7,
    oneWinner: persisted.participants.filter((entry) => entry.role === 'winner').length === 1,
    safeElimination: persisted.logs.every((entry) => !unsafeText.test(entry.text)),
    mapLifecycle: stageResults.every((entry) => entry.movementCommands >= 9),
    islandFerryRoute: stageResults[1].transfers === 0
      && stageResults[1].ferryMovements === 9,
    returnToTown: returnCommands.length === 9
      && returnCommands.every((command) =>
        command.kind === 'move'
        && command.description.includes('乘坐内河渡船')),
    rewardsUnique: new Set(rewardRows.map((row) => row.key)).size === rewardRows.length,
    rewardTotal: rewardRows.reduce((total, row) => total + row.amount, 0) === 220,
    historyArchived: persisted.event.archiveReason === 'completed'
      && !dailyEventTemplates.some((entry) => entry.name.includes('百万金贝')),
    normalLifeRestored: persisted.event.status === 'completed'
      && persisted.participants.every((entry) => entry.role !== 'competitor')
      && returnCommands.length === persisted.participants.length,
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed);
  if (failed.length > 0) {
    throw new Error(`Daily event runtime verification failed: ${failed.map(([key]) => key).join(', ')}`);
  }
  return {
    ok: true,
    mode: 'accelerated-isolated-rehearsal',
    durationMinutes: 120,
    template: template.name,
    venue: template.venue,
    winner: winner.displayName,
    stageResults,
    rewards: { rows: rewardRows.length, total: 220, unique: true },
    returnCommands: returnCommands.length,
    checks,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(verifyDailyEventRuntime(), null, 2)}\n`);
}
