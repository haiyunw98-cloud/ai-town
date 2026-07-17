import { getLifeProfileByName, residentLifeProfiles } from './lives';

const forbiddenGlobalStory = /海潮|潮汐|海风|海浪|无海航路|异常闪光|灯塔谜|机关谜|线索交汇|雾潮/u;
const forbiddenAutonomousStory = /海潮|潮汐|海风|海浪|无海航路|异常闪光|灯塔谜|机关谜|线索交汇|雾潮|航标|夜航/u;

describe('Lighthouse Town resident life profiles', () => {
  test('defines a complete adult dossier for every resident', () => {
    expect(residentLifeProfiles).toHaveLength(9);
    expect(new Set(residentLifeProfiles.map((profile) => profile.id)).size).toBe(9);
    for (const profile of residentLifeProfiles) {
      expect(profile.age).toBeGreaterThanOrEqual(20);
      expect(profile.occupation).toBeTruthy();
      expect(profile.home).toBeTruthy();
      expect(profile.outfit).toBeTruthy();
      expect(profile.diet).toBeTruthy();
      expect(profile.business).toBeTruthy();
      expect(profile.currentGoal).toBeTruthy();
      expect(profile.personality.length).toBeGreaterThanOrEqual(3);
      expect(profile.photos).toHaveLength(4);
      expect(profile.photos.every((photo) => photo.endsWith('.webp'))).toBe(true);
      for (const value of Object.values(profile.baseStats)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
    expect(getLifeProfileByName('林澜')?.occupation).toBe('灯塔守望人');
  });

  test('keeps relationship targets valid and includes social, romantic, and commercial life', () => {
    const ids = new Set(residentLifeProfiles.map((profile) => profile.id));
    const kinds = new Set(residentLifeProfiles.flatMap((profile) =>
      profile.relationships.map((relationship) => relationship.kind),
    ));
    for (const profile of residentLifeProfiles) {
      for (const relationship of profile.relationships) {
        expect(ids.has(relationship.targetId)).toBe(true);
        expect(relationship.targetId).not.toBe(profile.id);
        expect(relationship.score).toBeGreaterThanOrEqual(0);
        expect(relationship.score).toBeLessThanOrEqual(100);
      }
    }
    expect(kinds).toEqual(new Set(['friendship', 'crush', 'dating', 'business']));
  });

  test('uses matching labels for reciprocal business relationships', () => {
    for (const profile of residentLifeProfiles) {
      for (const relationship of profile.relationships) {
        if (relationship.kind !== 'business') continue;
        const target = residentLifeProfiles.find((candidate) => candidate.id === relationship.targetId);
        const reciprocal = target?.relationships.find((candidate) =>
          candidate.targetId === profile.id && candidate.kind === 'business',
        );
        if (reciprocal) expect(reciprocal.label).toBe(relationship.label);
      }
    }
  });

  test('looks profiles up by the resident display name', () => {
    expect(getLifeProfileByName('玄微先生')?.id).toBe('xuan-wei');
    expect(getLifeProfileByName('不存在')).toBeUndefined();
  });

  test('keeps resident dossiers focused on distinct daily livelihoods and relationships', () => {
    expect(JSON.stringify(residentLifeProfiles)).not.toMatch(forbiddenGlobalStory);
    const autonomousLife = residentLifeProfiles.map((profile) => ({
      currentGoal: profile.currentGoal,
      recentHighlights: profile.recentHighlights,
    }));
    expect(JSON.stringify(autonomousLife)).not.toMatch(forbiddenAutonomousStory);
    expect(new Set(residentLifeProfiles.map((profile) => profile.currentGoal)).size).toBe(9);
  });
});
