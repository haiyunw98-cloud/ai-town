import { deriveLiveStats } from './lives';

const baseStats = {
  mood: 60,
  energy: 60,
  health: 60,
  finance: 60,
  reputation: 60,
  social: 60,
};

describe('resident live dossier derivation', () => {
  test('conversation and recent messages improve the social snapshot', () => {
    const result = deriveLiveStats(baseStats, {
      isTalking: true,
      isMoving: false,
      recentMessageCount: 4,
    });
    expect(result.situation).toContain('交谈');
    expect(result.stats.social).toBeGreaterThan(baseStats.social);
    expect(result.stats.mood).toBeGreaterThan(baseStats.mood);
  });

  test('uses a current activity as the situation and recognizes commercial work', () => {
    const result = deriveLiveStats(baseStats, {
      isTalking: false,
      isMoving: false,
      activity: '正在茶馆整理今日账目',
      recentMessageCount: 0,
    });
    expect(result.situation).toBe('正在茶馆整理今日账目');
    expect(result.stats.finance).toBeGreaterThan(baseStats.finance);
  });

  test('clamps every derived attribute to the zero-to-one-hundred range', () => {
    const result = deriveLiveStats(
      { mood: 99, energy: 1, health: 100, finance: 100, reputation: 98, social: 100 },
      { isTalking: true, isMoving: true, recentMessageCount: 100 },
    );
    for (const value of Object.values(result.stats)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});
