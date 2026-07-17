import { readFileSync } from 'node:fs';
import {
  ACTIVITY_CATEGORIES,
  activitiesForResident,
  pickResidentActivity,
  residentActivities,
} from './activities';
import { townLandmarks } from './map';

const residentNames = ['林澜', '沈砚', '唐果', '墨七', '苏萤', '白露', '顾潮', '阿满', '玄微先生'];
const forbiddenRuntimeTopics = /海潮|潮汐|航标|海风|海浪|夜航|无海航路|异常闪光|灯塔谜|机关谜|线索交汇/u;

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
          (townLandmarks as unknown as ReadonlyArray<Record<string, any>>)
            .some((landmark) => landmark.id === (activity as any).landmarkId),
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
    expect(JSON.stringify(residentActivities)).not.toMatch(forbiddenRuntimeTopics);
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
    expect(operations).toContain('pickResidentActivity(args.residentName)');
    expect(operations).toContain('destination: landmark.destination');
    expect(operations).toContain('在${landmark.name}');
    expect(agent).not.toContain('doingActivity && (conversation || player.pathfinding)');
  });
});
