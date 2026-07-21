import { readFileSync } from 'node:fs';

describe('persistent town engine cadence', () => {
  test('saves a smooth two-second movement buffer instead of rewriting the world every second', () => {
    const source = readFileSync(new URL('./game.ts', import.meta.url), 'utf8');
    expect(source).toContain('tickDuration = 16;');
    expect(source).toContain('stepDuration = 2000;');
  });
});
