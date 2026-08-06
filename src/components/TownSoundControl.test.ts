import { readFileSync } from 'node:fs';

describe('town sound control', () => {
  test('exposes unlock and all three channels on mobile', () => {
    const source = readFileSync(new URL('./TownSoundControl.tsx', import.meta.url), 'utf8');
    expect(source).toContain('开启声音');
    expect(source).toContain('音乐');
    expect(source).toContain('环境');
    expect(source).toContain('音效');
    expect(source).not.toContain('hidden lg:block');
  });

  test('provider owns the only long-running background track', () => {
    const provider = readFileSync(new URL('../audio/TownAudioProvider.tsx', import.meta.url), 'utf8');
    const oldButton = readFileSync(new URL('./buttons/MusicButton.tsx', import.meta.url), 'utf8');
    expect(provider).toContain('background.mp3');
    expect(provider).toContain('AudioContext');
    expect(oldButton).not.toContain("sound.add('background'");
  });

  test('keeps visibility ducking separate and cleans up browser audio resources', () => {
    const provider = readFileSync(new URL('../audio/TownAudioProvider.tsx', import.meta.url), 'utf8');
    expect(provider).toContain('visibilityDucked');
    expect(provider).toContain('speechDucked');
    expect(provider).toContain("target instanceof HTMLInputElement");
    expect(provider).toContain('contextRef.current?.close()');
  });
});
