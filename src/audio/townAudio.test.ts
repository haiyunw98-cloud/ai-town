import {
  AUDIO_SETTINGS_KEY,
  audioSceneForWerewolfPhase,
  audioTrackForScene,
  loadAudioSettings,
  normalizeAudioSettings,
  saveAudioSettings,
} from './townAudio';

describe('town audio model', () => {
  test('bounds four independent channels', () => {
    expect(normalizeAudioSettings({ music: 4, ambience: -1, effects: 0.5, voice: 0.8 })).toEqual({
      enabled: true,
      music: 1,
      ambience: 0,
      effects: 0.5,
      voice: 0.8,
    });
  });

  test('maps every scene to an original soundtrack asset', () => {
    expect(audioTrackForScene('town').src).toContain('town-day.wav');
    expect(audioTrackForScene('werewolf-lobby').src).toContain('werewolf-discussion.wav');
    expect(audioTrackForScene('werewolf-night').src).toContain('werewolf-night.wav');
    expect(audioTrackForScene('werewolf-day').src).toContain('werewolf-discussion.wav');
    expect(audioTrackForScene('werewolf-vote').src).toContain('werewolf-vote.wav');
    expect(audioTrackForScene('werewolf-result').src).toContain('werewolf-result.wav');
    expect(audioTrackForScene('paused').src).toBe('');
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
    saveAudioSettings({ enabled: false, music: 0.2, ambience: 0.3, effects: 0.4, voice: 0.5 }, storage);
    expect(values.has(AUDIO_SETTINGS_KEY)).toBe(true);
    expect(loadAudioSettings(storage).enabled).toBe(false);
    values.set(AUDIO_SETTINGS_KEY, '{bad json');
    expect(loadAudioSettings(storage)).toEqual(normalizeAudioSettings());
  });
});
