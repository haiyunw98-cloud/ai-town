import { DAILY_TEMPLATE_IDS } from './dailySchedule';
import { dailyEventTemplates } from './dailyTemplates';

describe('daily event templates', () => {
  test('defines exactly the seven scheduled templates across both venues', () => {
    expect(dailyEventTemplates).toHaveLength(7);
    expect(dailyEventTemplates.map((template) => template.id)).toEqual(DAILY_TEMPLATE_IDS);
    expect(new Set(dailyEventTemplates.map((template) => template.id)).size).toBe(7);
    expect(new Set(dailyEventTemplates.map((template) => template.venue))).toEqual(
      new Set(['main-town', 'trial-island']),
    );
  });

  test('gives every template seven fixed stages spanning the full two-hour window', () => {
    for (const template of dailyEventTemplates) {
      expect(template.stages.map((stage) => stage.endsAtMinute)).toEqual([
        10, 35, 60, 70, 90, 110, 120,
      ]);
      expect(template.stages.map((stage) => stage.targetActive)).toEqual([
        9, 8, 6, 6, 4, 1, 1,
      ]);
      expect(template.stages.every((stage) => stage.checkpoints.length > 0)).toBe(true);
      expect(template.stages.every((stage) => stage.props.length > 0)).toBe(true);
      expect(template.stages.every((stage) => stage.choices.length === 2)).toBe(true);
    }
  });

  test('uses two teams, includes all nine residents, and turns eliminated residents into spectators', () => {
    for (const template of dailyEventTemplates) {
      expect(template.teamCount).toBe(2);
      expect(template.participantCount).toBe(9);
      expect(template.eliminationResult).toBe('spectator');
    }
  });

  test('keeps every activity safe and describes ordinary tasks in natural Chinese', () => {
    for (const template of dailyEventTemplates) {
      const serialized = JSON.stringify(template);
      expect(serialized).not.toMatch(/死亡|受伤|流血|处决|献祭|搏命|杀戮/);
      expect(serialized).not.toMatch(/灯塔异变|神秘机关|花木躁动|河道水位/);
      expect(template.name).toMatch(/[\u4e00-\u9fff]/);
      expect(template.stages.every((stage) => /[\u4e00-\u9fff]/.test(stage.label))).toBe(true);
      expect(
        template.stages.every((stage) =>
          stage.choices.every((choice) => /[\u4e00-\u9fff]/.test(choice.label)),
        ),
      ).toBe(true);
    }
  });
});
