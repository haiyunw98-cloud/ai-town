import { jest } from '@jest/globals';
import { agentInputs } from './agentInputs';
import {
  mapheight,
  mapwidth,
  objmap,
  trialIslandCheckpoints,
} from '../../data/worlds/lighthouse-town/map';

function activityGame(inProgressOperationId = 'o:activity:1') {
  const player = { id: 'p:1' };
  const agent = {
    id: 'a:1',
    playerId: 'p:1',
    inProgressOperation: { operationId: inProgressOperationId },
  };
  const game = {
    world: {
      agents: new Map([[agent.id, agent]]),
      players: new Map([[player.id, player]]),
    },
  };
  return { game, player, agent };
}

describe('finishDoSomething activity registration acknowledgement', () => {
  test('starts a delayed registered activity for its full duration at engine application time', () => {
    const { game, player } = activityGame();
    const appliedAt = 100_000;

    const result = agentInputs.finishDoSomething.handler(game as never, appliedAt, {
      operationId: 'o:activity:1',
      agentId: 'a:1' as never,
      activity: { description: '在听雨茶庄工作', emoji: '茶', until: 10_000 },
      activityDuration: 60_000,
      activityRegistrationId: 'activityRegistrations:1' as never,
    });

    expect(player).toEqual(expect.objectContaining({
      activity: { description: '在听雨茶庄工作', emoji: '茶', until: 160_000 },
    }));
    expect(result).toEqual({
      activityRegistration: {
        operationId: 'o:activity:1',
        registrationId: 'activityRegistrations:1',
        agentId: 'a:1',
        residentId: 'p:1',
        status: 'activated',
        activatedAt: appliedAt,
        activityUntil: 160_000,
      },
    });
  });

  test('acknowledges a replaced operation without applying its registered activity', () => {
    const { game, player } = activityGame('o:newer:2');
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);

    try {
      const result = agentInputs.finishDoSomething.handler(game as never, 100_000, {
        operationId: 'o:activity:1',
        agentId: 'a:1' as never,
        activity: { description: '过期活动', emoji: '茶', until: 10_000 },
        activityDuration: 60_000,
        activityRegistrationId: 'activityRegistrations:1' as never,
      });

      expect(player).not.toHaveProperty('activity');
      expect(result).toEqual({
        activityRegistration: {
          operationId: 'o:activity:1',
          registrationId: 'activityRegistrations:1',
          agentId: 'a:1',
          residentId: 'p:1',
          status: 'rejected',
          acknowledgedAt: 100_000,
          reason: 'operation-replaced',
        },
      });
    } finally {
      debug.mockRestore();
    }
  });
});

function ferryGame(playerOverrides: Record<string, unknown> = {}) {
  const player = {
    id: 'p:1',
    position: { x: 23, y: 6 },
    pathfinding: { destination: { x: 22, y: 15 } },
    speed: 1,
    ...playerOverrides,
  };
  const agent = {
    id: 'a:1',
    playerId: player.id,
    inProgressOperation: { name: 'agentDoSomething', operationId: 'o:late', started: 999_000 },
  };
  const game = {
    world: {
      players: new Map([[player.id, player]]),
      agents: new Map([[agent.id, agent]]),
      conversations: new Map(),
    },
    worldMap: { width: mapwidth, height: mapheight, objectTiles: objmap },
  };
  return { game, player, agent };
}

describe('controlled daily event ferry transfer', () => {
  const appliedAt = 1_000_000;
  const transfer = () => (agentInputs as unknown as {
    eventTransfer: typeof agentInputs.eventMove;
  }).eventTransfer;

  test('moves an AI resident only to the island allowlist and clears stale pathfinding', () => {
    const { game, player, agent } = ferryGame();
    const description = `${'协'.repeat(79)}👩‍👩‍👧‍👦多余`;

    expect(transfer().handler(game as never, appliedAt, {
      playerId: 'p:1' as never,
      destination: trialIslandCheckpoints.arrival,
      description: `  ${description}  `,
      until: appliedAt + 120_000,
    })).toBeNull();

    expect(player.position).toEqual(trialIslandCheckpoints.arrival);
    expect(agent).not.toHaveProperty('inProgressOperation');
    expect(player).not.toHaveProperty('pathfinding');
    expect(player.speed).toBe(0);
    expect(player).toEqual(expect.objectContaining({
      activity: {
        description: `${'协'.repeat(79)}👩‍👩‍👧‍👦`,
        emoji: '⛴️',
        until: appliedAt + 120_000,
      },
    }));
  });

  test('event movement cancels a pending AI operation so its late result cannot overwrite the event', () => {
    const { game, player, agent } = ferryGame();
    const move = agentInputs.eventMove;
    expect(move.handler(game as never, appliedAt, {
      playerId: 'p:1' as never,
      destination: { x: 22, y: 15 },
      description: '前往集合点',
      until: appliedAt + 60_000,
    })).toBeNull();
    expect(agent).not.toHaveProperty('inProgressOperation');

    const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    try {
      expect(agentInputs.finishDoSomething.handler(game as never, appliedAt + 1, {
        operationId: 'o:late',
        agentId: 'a:1' as never,
        destination: { x: 4, y: 4 },
      })).toBeNull();
      expect(player.pathfinding).toEqual(expect.objectContaining({
        destination: { x: 22, y: 15 },
      }));
    } finally {
      debug.mockRestore();
    }
  });

  test.each([
    [{ x: 51, y: 15 }, 'not an allowlisted checkpoint'],
    [{ x: 50.5, y: 15 }, 'not integral'],
    [{ x: Number.NaN, y: 15 }, 'not finite'],
    [{ x: 84, y: 15 }, 'out of bounds'],
    [{ x: 40, y: 15 }, 'blocked river'],
  ])('rejects destination %p (%s) without mutating the resident', (destination) => {
    const { game, player } = ferryGame();
    const before = structuredClone(player);
    expect(() => transfer().handler(game as never, appliedAt, {
      playerId: 'p:1' as never,
      destination,
      description: '乘船前往活动场地',
      until: appliedAt + 60_000,
    })).toThrow(/destination|checkpoint|walkable|bounds|finite|integer/iu);
    expect(player).toEqual(before);
  });

  test.each([
    ['', appliedAt + 60_000],
    ['   ', appliedAt + 60_000],
    ['乘船', appliedAt - 2 * 60 * 60_000 - 1],
    ['乘船', appliedAt + 2 * 60 * 60_000 + 1],
    ['乘船', Number.NaN],
  ])('rejects an invalid description or expiry without partial mutation', (description, until) => {
    const { game, player } = ferryGame();
    const before = structuredClone(player);
    expect(() => transfer().handler(game as never, appliedAt, {
      playerId: 'p:1' as never,
      destination: trialIslandCheckpoints.arrival,
      description,
      until,
    })).toThrow(/description|until|expiry|time/iu);
    expect(player).toEqual(before);
  });

  test('accepts a briefly delayed return command and expires it at engine application time', () => {
    const { game, player } = ferryGame({ position: trialIslandCheckpoints.awards });
    const serverQueuedAt = appliedAt - 5_000;

    expect(transfer().handler(game as never, appliedAt, {
      playerId: 'p:1' as never,
      destination: { x: 23, y: 6 },
      description: '乘摆渡船返回主镇，恢复普通生活',
      until: serverQueuedAt,
    })).toBeNull();

    expect(player.position).toEqual({ x: 23, y: 6 });
    expect((player as { activity?: { until: number } }).activity?.until).toBe(appliedAt);
  });

  test('accepts a walkable berth beside the old dock so returning residents can disembark separately', () => {
    const { game, player } = ferryGame({ position: trialIslandCheckpoints.awards });

    expect(transfer().handler(game as never, appliedAt, {
      playerId: 'p:1' as never,
      destination: { x: 22, y: 6 },
      description: '乘摆渡船返回主镇，恢复普通生活',
      until: appliedAt,
    })).toBeNull();

    expect(player.position).toEqual({ x: 22, y: 6 });
  });

  test('rejects a return command delayed by more than two hours without mutation', () => {
    const { game, player } = ferryGame({ position: trialIslandCheckpoints.awards });
    const before = structuredClone(player);

    expect(() => transfer().handler(game as never, appliedAt, {
      playerId: 'p:1' as never,
      destination: { x: 23, y: 6 },
      description: '过期返程',
      until: appliedAt - 2 * 60 * 60_000 - 1,
    })).toThrow(/expiry|stale|time|window/iu);
    expect(player).toEqual(before);
  });

  test('rejects humans and missing residents', () => {
    const human = ferryGame({ human: 'observer:1' });
    expect(() => transfer().handler(human.game as never, appliedAt, {
      playerId: 'p:1' as never,
      destination: trialIslandCheckpoints.arrival,
      description: '乘船',
      until: appliedAt,
    })).toThrow(/AI resident|human/iu);
    expect(human.player.position).toEqual({ x: 23, y: 6 });

    const missing = ferryGame();
    missing.game.world.players.clear();
    expect(() => transfer().handler(missing.game as never, appliedAt, {
      playerId: 'p:404' as never,
      destination: trialIslandCheckpoints.arrival,
      description: '乘船',
      until: appliedAt,
    })).toThrow(/resident|player|missing|find/iu);
  });
});
