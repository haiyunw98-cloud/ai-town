import { buildWerewolfRewardPlans } from './townEconomy';
import { buildWerewolfRelationshipEvidence } from './townRelations';
import type { WerewolfRole, WerewolfSeat, WerewolfState } from './werewolf/types';

const roles: WerewolfRole[] = [
  'werewolf', 'werewolf', 'werewolf', 'villager', 'villager',
  'villager', 'seer', 'witch', 'hunter',
];

function seats(): WerewolfSeat[] {
  return roles.map((role, index) => ({
    playerId: `p:${index}`,
    displayName: `居民${index}`,
    kind: index === 8 ? 'human' : 'ai',
    seatNumber: index + 1,
    role,
    alive: true,
    antidoteAvailable: role === 'witch',
    poisonAvailable: role === 'witch',
    hunterShotAvailable: role === 'hunter',
  }));
}

describe('werewolf social settlement plans', () => {
  test('AI participants receive five and winning AI residents receive another twenty', () => {
    const plans = buildWerewolfRewardPlans('session:1', seats(), 'good');
    expect(plans.filter((plan) => plan.tier === 'participation')).toHaveLength(8);
    expect(plans.filter((plan) => plan.tier === 'winner')).toHaveLength(5);
    expect(plans.filter((plan) => plan.residentId === 'p:3').map((plan) => plan.amount)).toEqual([5, 20]);
    expect(plans.some((plan) => plan.residentId === 'p:8')).toBe(false);
    expect(new Set(plans.map((plan) => plan.idempotencyKey)).size).toBe(plans.length);
  });

  test('public votes become bounded non-romantic relationship evidence', () => {
    const state: WerewolfState = {
      seed: 19, round: 2, phase: 'completed', seats: seats(), nightSaved: false,
      speakingOrder: [], runoffIds: [], privateResults: {}, winner: 'good', updatedAt: 2000,
      actions: [
        { kind: 'day-vote', actorId: 'p:3', targetId: 'p:4', at: 1500, round: 1, phase: 'day-voting' },
        { kind: 'day-vote', actorId: 'p:3', targetId: 'p:0', at: 1900, round: 2, phase: 'day-voting' },
      ],
    };
    const evidence = buildWerewolfRelationshipEvidence('session:1', state);
    expect(evidence).toHaveLength(2);
    expect(evidence.map((entry) => entry.kind)).toEqual(['cooperation', 'dispute']);
    expect(JSON.stringify(evidence)).not.toMatch(/attraction|恋爱/u);
  });
});
