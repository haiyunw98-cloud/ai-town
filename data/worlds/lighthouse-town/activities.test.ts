import { readFileSync } from 'node:fs';
import {
  ACTIVITY_CATEGORIES,
  activitiesForResident,
  feasibleActivitiesForState,
  pickResidentActivity,
  residentActivities,
} from './activities';
import { townLandmarks } from './map';
import { institutions, residentEconomyProfiles } from './economy';

const residentNames = ['林澜', '沈砚', '唐果', '墨七', '苏萤', '白露', '顾潮', '阿满', '玄微先生'];
const forbiddenAutonomousStory = /海潮|潮汐|海风|海浪|无海航路|异常闪光|灯塔谜|机关谜|线索交汇|雾潮|航标|夜航/u;

describe('Lighthouse Town resident activities', () => {
  test('gives every resident personalized Chinese activities across daily life', () => {
    expect(Object.keys(residentActivities)).toEqual(residentNames);

    for (const residentName of residentNames) {
      const activities = activitiesForResident(residentName);
      expect(activities.length).toBeGreaterThanOrEqual(5);
      expect(new Set(activities.map((activity) => activity.category))).toEqual(
        new Set(ACTIVITY_CATEGORIES),
      );

      for (const activity of activities) {
        expect(activity.description).toMatch(/[\u3400-\u9fff]/u);
        expect(activity.emoji).toBeTruthy();
        expect(activity.duration).toBeGreaterThan(0);
        expect(
          townLandmarks.some((landmark) => landmark.id === activity.landmarkId),
        ).toBe(true);
      }
    }
  });

  test('selects an activity from the named resident instead of a global generic list', () => {
    const tangGuoActivity = pickResidentActivity('唐果', () => 0);
    const moQiActivity = pickResidentActivity('墨七', () => 0);

    expect(activitiesForResident('唐果')).toContain(tangGuoActivity);
    expect(activitiesForResident('墨七')).toContain(moQiActivity);
    expect(tangGuoActivity).not.toEqual(moQiActivity);
    expect(tangGuoActivity.description).toContain('茶馆');
    expect(moQiActivity.description).toContain('摆渡');
  });

  test('keeps every autonomous activity focused on inland daily life', () => {
    const descriptions = Object.values(residentActivities).flatMap((activities) =>
      activities.map((activity) => activity.description),
    );
    expect(JSON.stringify(descriptions)).not.toMatch(forbiddenAutonomousStory);
  });

  test('offers every resident autonomous work purchase and rest choices with structured facts', () => {
    for (const profile of residentEconomyProfiles) {
      const activities = activitiesForResident(profile.name);
      const work = activities.find((entry) => entry.economicAction?.kind === 'work');
      const purchase = activities.find((entry) => entry.economicAction?.kind === 'purchase');
      const rest = activities.find((entry) => entry.economicAction?.kind === 'rest');
      expect(work?.economicAction).toEqual({
        kind: 'work',
        institutionId: profile.institutionId,
        output: profile.workOutput,
      });
      expect(work?.landmarkId).toBe(profile.institutionId);
      expect(rest).toBeDefined();
      expect(purchase?.economicAction?.kind).toBe('purchase');
      if (purchase?.economicAction?.kind === 'purchase') {
        const purchaseAction = purchase.economicAction;
        const institution = institutions.find(
          (entry) => entry.id === purchaseAction.institutionId,
        );
        expect(institution?.goods).toContain(purchaseAction.goodId);
        expect(purchase.landmarkId).toBe(institution?.landmarkId);
      }
      expect(new Set(activities.map((entry) => entry.category)).size).toBeGreaterThan(3);
    }
  });

  test('passes the player description name through the agent activity operation', () => {
    const agent = readFileSync(new URL('../../../convex/aiTown/agent.ts', import.meta.url), 'utf8');
    const operations = readFileSync(
      new URL('../../../convex/aiTown/agentOperations.ts', import.meta.url),
      'utf8',
    );

    expect(agent).toContain('const playerDescription = game.playerDescriptions.get(player.id)');
    expect(agent).toContain('residentName: playerDescription.name');
    expect(operations).toContain('residentName: v.string()');
    expect(operations).toContain('feasibleActivitiesForState(args.residentName, residentState)');
    expect(operations).toContain('chooseResidentActivityWithLocalModel');
    expect(operations).toContain('destination: landmark.destination');
    expect(operations).toContain('在${landmark.name}');
    expect(operations).toContain('enqueueResidentActivity');
    expect(operations).toContain("phase: 'start'");
    expect(operations).toContain('sourceKey: `activity:${registration.operationId}:start`');
    expect(operations).toContain("result.status !== 'destination-not-reached'");
    expect(agent).not.toContain('doingActivity && (conversation || player.pathfinding)');
  });

  test('keeps multiple feasible choices and exposes ordinary needs as model context', () => {
    const view = feasibleActivitiesForState('唐果', {
      hunger: 20,
      energy: 90,
      balance: 40,
    });

    expect(view.needs).toContain('food');
    expect(view.activities.map((entry) => entry.category)).toEqual(
      expect.arrayContaining(['food', 'work', 'social']),
    );
    expect(view.activities.length).toBeGreaterThan(2);
  });

  test('filters food purchases that cannot settle for funds or stock', () => {
    expect(feasibleActivitiesForState('唐果', {
      hunger: 10,
      energy: 80,
      balance: 0,
    }).activities.some((entry) => entry.category === 'food')).toBe(false);

    expect(feasibleActivitiesForState('唐果', {
      hunger: 10,
      energy: 80,
      balance: 40,
      institutions: [{
        institutionId: 'restaurant',
        cash: 120,
        stock: { meal: 0 },
      }],
    }).activities.some((entry) => entry.category === 'food')).toBe(false);
  });

  test('retains both food and rest when both needs are critical', () => {
    const view = feasibleActivitiesForState('唐果', {
      hunger: 5,
      energy: 5,
      balance: 40,
    });

    expect(view.criticalNeeds).toEqual(['food', 'rest']);
    expect(view.activities.map((entry) => entry.category)).toEqual(
      expect.arrayContaining(['food', 'care']),
    );
  });
});
