import { readFileSync } from 'node:fs';

describe('Lighthouse Town original audio generator', () => {
  test('defines five distinct safe loop compositions', () => {
    const source = readFileSync(
      new URL('./generate-lighthouse-audio.mjs', import.meta.url),
      'utf8',
    );
    for (const id of [
      'town-day',
      'werewolf-night',
      'werewolf-discussion',
      'werewolf-vote',
      'werewolf-result',
    ]) {
      expect(source).toContain(`'${id}'`);
    }
    expect(source).toContain('RIFF');
    expect(source).toContain('writeInt16LE');
    expect(source).not.toMatch(/海浪|汽笛|horror|scream/ui);
  });
});
