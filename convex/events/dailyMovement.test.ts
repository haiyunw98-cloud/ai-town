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
  executeDailyMovementBatch: (
    markerKey: string,
    commands: readonly Command[],
    fallbackKind: 'move' | 'transfer',
    io: {
      markerCount: (key: string) => Promise<number>;
      enqueue: (command: Command) => Promise<void>;
      recordFailure: (key: string, residentId: string, error: unknown) => Promise<void>;
      recordMarker: (key: string) => Promise<void>;
    },
  ) => Promise<{ status: string; queued: number; failures: number }>;
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

  test('transfers every island participant at first arrival, then separates competitors and spectators', () => {
    const commands = movement.buildDailyStageMovementCommands(
      dailyEventTemplates[0], 1, participants, now, phaseEndsAt, true,
    );
    const transfers = commands.filter((command) => command.kind === 'transfer');
    const moves = commands.filter((command) => command.kind === 'move');
    expect(transfers).toHaveLength(9);
    expect(transfers.every((command) =>
      command.destination.x === trialIslandCheckpoints.arrival.x
      && command.destination.y === trialIslandCheckpoints.arrival.y,
    )).toBe(true);
    expect(moves).toHaveLength(9);
    expect(commands.every((command) => command.until === phaseEndsAt)).toBe(true);
    expect(new Set(moves.map((command) =>
      `${command.destination.x}:${command.destination.y}`,
    )).size).toBe(9);
    for (const command of moves) expectWalkable(command.destination);
    expect(moves.slice(0, 4).every((command) => command.destination.x < 65)).toBe(true);
    expect(moves.slice(4).every((command) => command.destination.x >= 76)).toBe(true);
  });

  test('preserves a slightly elapsed phase deadline for the delayed input layer to clamp', () => {
    const elapsedPhaseEnd = now - 5_000;
    const commands = movement.buildDailyStageMovementCommands(
      dailyEventTemplates[0], 1, participants, now, elapsedPhaseEnd, true,
    );
    expect(commands.every((command) => command.until === elapsedPhaseEnd)).toBe(true);
  });

  test('moves later island stages without another transfer and main-town stages never transfer', () => {
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

  test('returns island residents by controlled transfer and main-town residents by safe movement', () => {
    const island = movement.buildDailyReturnMovementCommands(
      'trial-island', participants, now,
    );
    expect(island).toHaveLength(9);
    expect(island.every((command) => command.kind === 'transfer')).toBe(true);
    expect(island.every((command) => command.until === now)).toBe(true);
    expect(island.every((command) =>
      command.destination.x === eventCheckpoints.dock.x
      && command.destination.y === eventCheckpoints.dock.y,
    )).toBe(true);

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

  test('queues one idempotent movement batch and skips the repeated cron pass', async () => {
    const commands = movement.buildDailyStageMovementCommands(
      dailyEventTemplates[1], 2, participants, now, phaseEndsAt, false,
    );
    const markers = new Set<string>();
    const queued: Command[] = [];
    const io = {
      markerCount: async (key: string) => Number(markers.has(key)),
      enqueue: async (command: Command) => { queued.push(command); },
      recordFailure: async () => undefined,
      recordMarker: async (key: string) => { markers.add(key); },
    };
    const markerKey = 'daily:2026-07-19:movement:stage:2';
    await expect(movement.executeDailyMovementBatch(
      markerKey, commands, 'move', io,
    )).resolves.toEqual({ status: 'queued', queued: 9, failures: 0 });
    await expect(movement.executeDailyMovementBatch(
      markerKey, commands, 'move', io,
    )).resolves.toEqual({ status: 'already-queued', queued: 0, failures: 0 });
    expect(queued).toHaveLength(9);
  });

  test('isolates one resident insertion failure, attempts a dock fallback, and still marks the batch', async () => {
    const commands = movement.buildDailyStageMovementCommands(
      dailyEventTemplates[0], 4, participants, now, phaseEndsAt, false,
    );
    const attempts: Command[] = [];
    const failures: string[] = [];
    const markers: string[] = [];
    let failedOnce = false;
    const io = {
      markerCount: async () => 0,
      enqueue: async (command: Command) => {
        attempts.push(command);
        if (command.residentId === 'p:2' && !failedOnce) {
          failedOnce = true;
          throw new Error('engine input unavailable');
        }
      },
      recordFailure: async (key: string, residentId: string) => {
        failures.push(`${key}:${residentId}`);
      },
      recordMarker: async (key: string) => { markers.push(key); },
    };
    await expect(movement.executeDailyMovementBatch(
      'daily:2026-07-19:movement:stage:4', commands, 'transfer', io,
    )).resolves.toEqual({ status: 'queued', queued: 8, failures: 1 });
    expect(attempts).toHaveLength(10);
    expect(attempts.at(-1)).toEqual(expect.objectContaining({
      kind: 'transfer', residentId: 'p:2', destination: eventCheckpoints.dock,
    }));
    expect(failures).toEqual([
      'daily:2026-07-19:movement:stage:4:failure:p:2',
    ]);
    expect(markers).toEqual(['daily:2026-07-19:movement:stage:4']);
  });

  test('does not swallow a structural movement-marker collision', async () => {
    let enqueued = false;
    await expect(movement.executeDailyMovementBatch(
      'daily:2026-07-19:movement:stage:1',
      movement.buildDailyStageMovementCommands(
        dailyEventTemplates[0], 1, participants, now, phaseEndsAt, true,
      ),
      'transfer',
      {
        markerCount: async () => 2,
        enqueue: async () => { enqueued = true; },
        recordFailure: async () => undefined,
        recordMarker: async () => undefined,
      },
    )).rejects.toThrow(/collision|ambiguous|duplicate/iu);
    expect(enqueued).toBe(false);
  });
});
