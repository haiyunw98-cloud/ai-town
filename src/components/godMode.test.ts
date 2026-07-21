import { godModeQuickCommands } from './godMode';

describe('god mode controls', () => {
  test('offers direct daily-life commands with real map destinations', () => {
    expect(godModeQuickCommands.map((command) => command.id)).toEqual([
      'work',
      'rest',
      'eat',
      'shop',
      'plaza',
    ]);
    for (const command of godModeQuickCommands) {
      expect(command.label).toMatch(/[\u4e00-\u9fff]/u);
      expect(command.landmarkId).toMatch(/^(workplace|tea-house|restaurant|morning-market|plaza)$/u);
      expect(command.durationMs).toBeGreaterThan(0);
    }
  });
});
