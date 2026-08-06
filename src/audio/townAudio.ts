import type { WerewolfPhase } from '../../convex/werewolf/types';

export type AudioSettings = {
  enabled: boolean;
  music: number;
  ambience: number;
  effects: number;
};

export type AudioScene =
  | 'town'
  | 'werewolf-lobby'
  | 'werewolf-night'
  | 'werewolf-day'
  | 'werewolf-vote'
  | 'werewolf-result'
  | 'paused';

export type AudioChannel = 'music' | 'ambience' | 'effects';
export const AUDIO_SETTINGS_KEY = 'lighthouse-town:audio:v1';

const clamp = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;

export function normalizeAudioSettings(value: Partial<AudioSettings> = {}): AudioSettings {
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    music: clamp(value.music, 0.55),
    ambience: clamp(value.ambience, 0.35),
    effects: clamp(value.effects, 0.7),
  };
}

type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadAudioSettings(storage?: SettingsStorage): AudioSettings {
  const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!target) return normalizeAudioSettings();
  try {
    const raw = target.getItem(AUDIO_SETTINGS_KEY);
    return raw ? normalizeAudioSettings(JSON.parse(raw) as Partial<AudioSettings>) : normalizeAudioSettings();
  } catch {
    return normalizeAudioSettings();
  }
}

export function saveAudioSettings(settings: AudioSettings, storage?: SettingsStorage) {
  const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!target) return;
  try {
    target.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(normalizeAudioSettings(settings)));
  } catch {
    // Private browsing and quota failures should never stop the town.
  }
}

export function audioSceneForWerewolfPhase(phase: WerewolfPhase): AudioScene {
  if (phase.startsWith('night-')) return 'werewolf-night';
  if (phase === 'day-voting' || phase === 'runoff-voting' || phase === 'hunter') {
    return 'werewolf-vote';
  }
  if (phase === 'completed') return 'werewolf-result';
  if (phase === 'dawn' || phase === 'day-speaking' || phase === 'runoff-speaking') {
    return 'werewolf-day';
  }
  return 'werewolf-lobby';
}
