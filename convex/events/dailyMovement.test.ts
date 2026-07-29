import * as eventsModule from '../events';
import { dailyEventTemplates, type DailyEventTemplate } from './dailyTemplates';
import {
  eventCheckpoints,
  mapheight,
  mapwidth,
  objmap,
  trialIslandCheckpoints,
} from '../../data/worlds/lighthouse-town/map';

type Participant = { residentId: string; displayName: string; active: boolean };
type Command = {
  kind: 'move' | 'transfer';
  residentId: string;
  destination: { x: number; y: number };
  description: string;
  until: number;
};

const movement = eventsModule as unknown as {
  buildDailyStageMovementCommands: (
    template: DailyEventTemplate,
    stageIndex: number,
    participants: readonly Participant[],
    now: number,
    phaseEndsAt: number,
    includeIslandTransfer: boolean,
  ) => Command[];
  buildDailyReturnMovementCommands: (
    venue: 'main-town' | 'trial-island',
    participants: readonly Participant[],
    now: number,
  ) => Command[];
  buildDailyStagePulseMovementCommands: (
    template: DailyEventTemplate,
    stageIndex: number,
    participants: readonly Participant[],
    pulseIndex: number,
    phaseEndsAt: number,
  ) => Command[];
  dailyMovementCommandKey: (
    markerKey: string,
    commandIndex: number,
    command: Pick<Command, 'kind' | 'residentId'>,
  ) => string;
  dailyMovementBatchStatus: (
    outcomes: readonly ('success' | 'pending' | 'failed')[],
  ) => 'pending' | 'failed' | 'completed';
  formatDailyMovementCompletion: (
    entries: readonly { displayName: string; description: string }[],
  ) => string;
  dailyActivityPulseIndex: (
    template: DailyEventTemplate,
    stageIndex: number,
    startedAt: number,
    now: number,
  ) => number;
};

const participants: Participant[] = Array.from({ length: 9 }, (_, index) => ({
  residentId: `p:${index}`,
  displayName: `居民${index}`,
  active: index < 4,
}));
const now = Date.parse('2026-07-19T05:15:00Z');
const phaseEndsAt = now + 20 * 60_000;

function expectWalkable(destination: { x: number; y: number }) {
  expect(Number.isInteger(destination.x)).toBe(true);
  expect(Number.isInteger(destination.y)).toBe(true);
  expect(destination.x).toBeGreaterThanOrEqual(0);
  expect(destination.x).toBeLessThan(mapwidth);
  expect(destination.y).toBeGreaterThanOrEqual(0);
  expect(destination.y).toBeLessThan(mapheight);
  expect(objmap[0][destination.x][destination.y]).toBe(-1);
}

describe('daily event map movement planning', () => {
  test('queues all nine residents at distinct walkable old-dock positions during assembly', () => {
    const commands = movement.buildDailyStageMovementCommands(
      dailyEventTemplates[0], 0, participants, now, phaseEndsAt, false,
    );
    expect(commands).toHaveLength(9);
    expect(commands.every((command) => command.kind === 'move')).toBe(true);
    expect(new Set(commands.map((command) =>
      `${command.destination.x}:${command.destination.y}`,
    )).size).toBe(9);
    for (const command of commands) {
      expect(Math.abs(command.destination.x - eventCheckpoints.dock.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(command.destination.y - eventCheckpoints.dock.y)).toBeLessThanOrEqual(3);
      expectWalkable(command.destination);
    }
  });

  test('sends every island participant over the visible ferry route, then separates competitors and spectators', () => {
    const commands = movement.buildDailyStageMovementCommands(
      dailyEventTemplates[0], 1, participants, now, phaseEndsAt, true,
    );
    const moves = commands.filter((command) => command.kind === 'move');
    expect(moves).toHaveLength(9);
    expect(commands.every((command) => command.until === phaseEndsAt)).toBe(true);
    expect(commands.every((command) => command.description.includes('乘坐内河渡船'))).toBe(true);
    expect(new Set(moves.map((command) =>
      `${command.destination.x}:${command.destination.y}`,
    )).size).toBe(9);
    for (const command of moves) expectWalkable(command.destination);
    expect(moves.slice(0, 4).every((command) =>
      Math.abs(command.destination.x - trialIslandCheckpoints.track.x) <= 2
      && Math.abs(command.destination.y - trialIslandCheckpoints.track.y) <= 2,
    )).toBe(true);
    expect(moves.slice(4).every((command) =>
      Math.abs(command.destination.x - trialIslandCheckpoints.spectatorStand.x) <= 2
      && Math.abs(command.destination.y - trialIslandCheckpoints.spectatorStand.y) <= 2,
    )).toBe(true);
  });

  test('preserves a slightly elapsed phase deadline for the delayed input layer to clamp', () => {
    const elapsedPhaseEnd = now - 5_000;
    const commands = movement.buildDailyStageMovementCommands(
      dailyEventTemplates[0], 1, participants, now, elapsedPhaseEnd, true,
    );
    expect(commands.every((command) => command.until === elapsedPhaseEnd)).toBe(true);
  });

  test('moves all later stages by pathfinding and never queues a coordinate transfer', () => {
    const island = movement.buildDailyStageMovementCommands(
      dailyEventTemplates[0], 4, participants, now, phaseEndsAt, false,
    );
    expect(island).toHaveLength(9);
    expect(island.every((command) => command.kind === 'move')).toBe(true);
    const mainTown = movement.buildDailyStageMovementCommands(
      dailyEventTemplates[1], 2, participants, now, phaseEndsAt, true,
    );
    expect(mainTown).toHaveLength(9);
    expect(mainTown.every((command) => command.kind === 'move')).toBe(true);
    for (const command of [...island, ...mainTown]) expectWalkable(command.destination);
  });

  test('rotates live island competitors through a later track position instead of leaving them stationary', () => {
    const firstPulse = movement.buildDailyStagePulseMovementCommands(
      dailyEventTemplates[0], 1, participants, 1, phaseEndsAt,
    );
    const secondPulse = movement.buildDailyStagePulseMovementCommands(
      dailyEventTemplates[0], 1, participants, 2, phaseEndsAt,
    );

    expect(firstPulse).toHaveLength(9);
    expect(firstPulse.every((command) => command.kind === 'move')).toBe(true);
    expect(firstPulse.every((command) => command.description.includes('第 1'))).toBe(true);
    expect(firstPulse.map((command) => command.destination)).not.toEqual(
      secondPulse.map((command) => command.destination),
    );
    for (const command of [...firstPulse, ...secondPulse]) expectWalkable(command.destination);
  });

  test('starts a fresh visible movement pulse every 45 seconds within an active stage', () => {
    expect(movement.dailyActivityPulseIndex(dailyEventTemplates[0], 1, now, now + 10 * 60_000)).toBe(0);
    expect(movement.dailyActivityPulseIndex(dailyEventTemplates[0], 1, now, now + 10 * 60_000 + 45_000)).toBe(1);
    expect(movement.dailyActivityPulseIndex(dailyEventTemplates[0], 1, now, now + 10 * 60_000 + 90_000)).toBe(2);
  });

  test('fails closed before planning any movement for an unknown checkpoint or malformed roster', () => {
    const template = {
      ...dailyEventTemplates[0],
      stages: dailyEventTemplates[0].stages.map((stage, index) =>
        index === 2 ? { ...stage, checkpoints: ['unknown-place'] } : stage),
    };
    expect(() => movement.buildDailyStageMovementCommands(
      template, 2, participants, now, phaseEndsAt, false,
    )).toThrow(/unknown.*checkpoint/iu);
    expect(() => movement.buildDailyStageMovementCommands(
      dailyEventTemplates[0], 1, participants.slice(0, 8), now, phaseEndsAt, true,
    )).toThrow(/nine|9|roster/iu);
  });

  test('returns island residents over the ferry lane and main-town residents by safe movement', () => {
    const island = movement.buildDailyReturnMovementCommands(
      'trial-island', participants, now,
    );
    expect(island).toHaveLength(9);
    expect(island.every((command) => command.kind === 'move')).toBe(true);
    expect(island.every((command) => command.until === now + 15 * 60_000)).toBe(true);
    expect(island.every((command) => command.description.includes('乘坐内河渡船'))).toBe(true);
    expect(new Set(island.map((command) =>
      `${command.destination.x}:${command.destination.y}`,
    )).size).toBe(9);
    for (const command of island) {
      expect(Math.abs(command.destination.x - eventCheckpoints.dock.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(command.destination.y - eventCheckpoints.dock.y)).toBeLessThanOrEqual(3);
      expectWalkable(command.destination);
    }

    const mainTown = movement.buildDailyReturnMovementCommands(
      'main-town', participants, now,
    );
    expect(mainTown).toHaveLength(9);
    expect(mainTown.every((command) => command.kind === 'move')).toBe(true);
    expect(new Set(mainTown.map((command) =>
      `${command.destination.x}:${command.destination.y}`,
    )).size).toBe(9);
    for (const command of mainTown) expectWalkable(command.destination);
  });

  test('builds stable, per-command idempotency keys for ferry-route movement recovery', () => {
    const commands = movement.buildDailyStageMovementCommands(
      dailyEventTemplates[0], 1, participants, now, phaseEndsAt, true,
    );
    const batchKey = 'daily:2026-07-19:movement:stage:1';
    const keys = commands.map((command, index) =>
      movement.dailyMovementCommandKey(batchKey, index, command));
    expect(new Set(keys).size).toBe(9);
    expect(keys[0]).toBe(`${batchKey}:command:0:move:p:0`);
    expect(keys[8]).toBe(`${batchKey}:command:8:move:p:8`);
    expect(movement.dailyMovementCommandKey(batchKey, 0, commands[0])).toBe(keys[0]);
  });

  test('confirms a batch only after every individual engine input succeeds or recovers', () => {
    expect(movement.dailyMovementBatchStatus(['success', 'success'])).toBe('completed');
    expect(movement.dailyMovementBatchStatus(['success', 'pending'])).toBe('pending');
    expect(movement.dailyMovementBatchStatus(['success', 'failed'])).toBe('failed');
    expect(movement.dailyMovementBatchStatus([])).toBe('pending');
  });

  test('renders a readable per-resident movement record instead of a generic engine marker', () => {
    expect(movement.formatDailyMovementCompletion([
      { displayName: '林澜', description: '参加按令前进赛道' },
      { displayName: '沈砚', description: '在试炼岛观众席观看活动并为同伴加油' },
    ])).toBe('地图行动确认：林澜参加按令前进赛道；沈砚在试炼岛观众席观看活动并为同伴加油。');
  });
});
