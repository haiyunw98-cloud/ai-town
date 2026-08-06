import {
  AUDIO_SETTINGS_KEY,
  audioSceneForWerewolfPhase,
  loadAudioSettings,
  normalizeAudioSettings,
  saveAudioSettings,
} from './townAudio';

describe('town audio model', () => {
  test('bounds three independent channels', () => {
    expect(normalizeAudioSettings({ music: 4, ambience: -1, effects: 0.5 })).toEqual({
      enabled: true,
      music: 1,
      ambience: 0,
      effects: 0.5,
    });
  });

  test('maps werewolf phases to distinct audio scenes', () => {
    expect(audioSceneForWerewolfPhase('night-wolves')).toBe('werewolf-night');
    expect(audioSceneForWerewolfPhase('day-speaking')).toBe('werewolf-day');
    expect(audioSceneForWerewolfPhase('day-voting')).toBe('werewolf-vote');
    expect(audioSceneForWerewolfPhase('completed')).toBe('werewolf-result');
  });

  test('persists settings and safely recovers malformed values', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    saveAudioSettings({ enabled: false, music: 0.2, ambience: 0.3, effects: 0.4 }, storage);
    expect(values.has(AUDIO_SETTINGS_KEY)).toBe(true);
    expect(loadAudioSettings(storage).enabled).toBe(false);
    values.set(AUDIO_SETTINGS_KEY, '{bad json');
    expect(loadAudioSettings(storage)).toEqual(normalizeAudioSettings());
  });
});
