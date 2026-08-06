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

  test.each([
    ['town-day', 70],
    ['werewolf-night', 60],
    ['werewolf-discussion', 64],
    ['werewolf-vote', 44],
    ['werewolf-result', 20],
  ])('%s is a non-silent valid WAV', (id, minimumSeconds) => {
    const bytes = readFileSync(new URL(
      `../public/assets/audio/lighthouse-town/${id}.wav`,
      import.meta.url,
    ));
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString()).toBe('WAVE');
    expect(bytes.length).toBeGreaterThan(22050 * 2 * minimumSeconds);
    const sampleWindow = bytes.subarray(44, Math.min(bytes.length, 22050));
    expect(sampleWindow.some((value) => value !== 0)).toBe(true);
  });

  test('ships an auditable original soundtrack manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL(
      '../public/assets/audio/lighthouse-town/manifest.json',
      import.meta.url,
    ), 'utf8')) as { tracks: Array<Record<string, unknown>> };
    expect(manifest.tracks).toHaveLength(5);
    expect(manifest.tracks.every((track) => track.loopSafe === true)).toBe(true);
    expect(manifest.tracks.every((track) =>
      track.license === 'Original project-generated audio; MIT project distribution')).toBe(true);
  });
});
