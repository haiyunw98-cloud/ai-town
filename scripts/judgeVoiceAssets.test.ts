import { readFileSync } from 'node:fs';
import { judgeCue, WEREWOLF_OPENING_CUES } from '../src/components/werewolfJudge';

describe('bundled female judge narration', () => {
  const manifest = JSON.parse(readFileSync(new URL(
    '../public/assets/audio/lighthouse-town/judge/manifest.json', import.meta.url,
  ), 'utf8')) as { tracks: Array<{ text: string; src: string; aiGenerated: boolean }> };
  const texts = new Set(manifest.tracks.map((track) => track.text));

  test('contains every fixed judge subtitle verbatim', () => {
    for (const cue of WEREWOLF_OPENING_CUES) expect(texts.has(cue.line)).toBe(true);
    for (const phase of [
      'night-wolves', 'night-seer', 'night-witch', 'dawn', 'day-speaking',
      'day-voting', 'runoff-speaking', 'runoff-voting', 'hunter', 'completed',
    ] as const) {
      expect(texts.has(judgeCue({ phase, round: 1 }).line)).toBe(true);
    }
  });

  test('contains dynamic speaker and dawn subtitles used by the live roster', () => {
    expect(texts.has(judgeCue({ phase: 'day-speaking', round: 1, speakingPlayerName: '林澜' }).line)).toBe(true);
    expect(texts.has(judgeCue({ phase: 'dawn', round: 1, dawnDepartures: ['白露', '墨七'] }).line)).toBe(true);
    expect(manifest.tracks).toHaveLength(124);
    expect(manifest.tracks.every((track) => track.aiGenerated && track.src.endsWith('.m4a'))).toBe(true);
  });
});
