import { jest } from '@jest/globals';
import { agentInputs } from './agentInputs';

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
