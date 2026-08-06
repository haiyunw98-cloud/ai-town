import { readFileSync } from 'node:fs';

describe('town sound control', () => {
  test('exposes unlock and all four channels on mobile', () => {
    const source = readFileSync(new URL('./TownSoundControl.tsx', import.meta.url), 'utf8');
    expect(source).toContain('开启声音');
    expect(source).toContain('音乐');
    expect(source).toContain('环境');
    expect(source).toContain('音效');
    expect(source).toContain('法官');
    expect(source).not.toContain('hidden lg:block');
  });

  test('provider owns the only long-running background track', () => {
    const provider = readFileSync(new URL('../audio/TownAudioProvider.tsx', import.meta.url), 'utf8');
    const oldButton = readFileSync(new URL('./buttons/MusicButton.tsx', import.meta.url), 'utf8');
    expect(provider).toContain('audioTrackForScene');
    expect(provider).toContain('await playSceneTrack(sceneRef.current, enabledSettings, true)');
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

  test('reports the real playback state and offers retry on failure', () => {
    const source = readFileSync(new URL('./TownSoundControl.tsx', import.meta.url), 'utf8');
    expect(source).toContain('currentTrack.title');
    expect(source).toContain('playbackStatus');
    expect(source).toContain('playbackError');
    expect(source).toContain('重试播放');
  });
});
