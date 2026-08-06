import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AudioChannel,
  AudioScene,
  AudioSettings,
  AudioTrack,
  audioTrackForScene,
  loadAudioSettings,
  normalizeAudioSettings,
  saveAudioSettings,
} from './townAudio';

type TownEffect = 'bell' | 'reveal' | 'gavel' | 'target' | 'vote';
export type PlaybackStatus = 'locked' | 'loading' | 'playing' | 'muted' | 'paused' | 'error';
type TownAudioApi = {
  settings: AudioSettings;
  unlocked: boolean;
  scene: AudioScene;
  currentTrack: AudioTrack;
  playbackStatus: PlaybackStatus;
  playbackError?: string;
  unlock: () => Promise<void>;
  retry: () => Promise<void>;
  setScene: (scene: AudioScene) => void;
  setChannel: (channel: AudioChannel, value: number) => void;
  toggleMute: () => void;
  setDucked: (ducked: boolean) => void;
  playEffect: (effect: TownEffect) => void;
};

const TownAudioContext = createContext<TownAudioApi | null>(null);
type BrowserWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
type AudioDeck = { audio: HTMLAudioElement; trackId: string };

function makeNoise(ctx: AudioContext, volume: number, frequency: number) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * 2));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) data[index] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.loop = true;
  filter.type = 'lowpass';
  filter.frequency.value = frequency;
  gain.gain.value = volume;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
  return source;
}

function playbackMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return '浏览器拦截了自动播放，请再次点击“开启声音”。';
  }
  return error instanceof Error ? `声音播放失败：${error.message}` : '声音播放失败，请重试。';
}

export function TownAudioProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState(loadAudioSettings);
  const [unlocked, setUnlocked] = useState(false);
  const [scene, setSceneState] = useState<AudioScene>('town');
  const [speechDucked, setSpeechDucked] = useState(false);
  const [visibilityDucked, setVisibilityDucked] = useState(() => document.hidden);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>('locked');
  const [playbackError, setPlaybackError] = useState<string>();
  const contextRef = useRef<AudioContext>();
  const decksRef = useRef<AudioDeck[]>([]);
  const activeDeckRef = useRef(0);
  const fadeTokenRef = useRef(0);
  const sceneSourcesRef = useRef<AudioScheduledSourceNode[]>([]);
  const sceneRef = useRef(scene);
  const settingsRef = useRef(settings);
  const duckedRef = useRef(false);

  const ensureAudio = useCallback(() => {
    if (!contextRef.current) {
      const AudioContextClass = window.AudioContext ?? (window as BrowserWindow).webkitAudioContext;
      if (!AudioContextClass) throw new Error('当前浏览器不支持声音播放。');
      contextRef.current = new AudioContextClass();
    }
    if (decksRef.current.length === 0) {
      decksRef.current = [0, 1].map(() => {
        const audio = new Audio();
        audio.loop = true;
        audio.preload = 'auto';
        return { audio, trackId: '' };
      });
    }
    return contextRef.current;
  }, []);

  const stopMusic = useCallback((status: PlaybackStatus) => {
    fadeTokenRef.current += 1;
    decksRef.current.forEach(({ audio }) => audio.pause());
    setPlaybackStatus(status);
  }, []);

  const playSceneTrack = useCallback(async (
    nextScene: AudioScene,
    nextSettings: AudioSettings,
    immediate = false,
  ) => {
    ensureAudio();
    if (!nextSettings.enabled) {
      stopMusic('muted');
      return;
    }
    const track = audioTrackForScene(nextScene);
    if (!track.src) {
      stopMusic('paused');
      return;
    }
    const duck = duckedRef.current ? 0.28 : 1;
    const targetVolume = nextSettings.music * 0.62 * duck;
    const active = decksRef.current[activeDeckRef.current];
    setPlaybackStatus('loading');
    setPlaybackError(undefined);
    try {
      if (active.trackId === track.id) {
        active.audio.volume = targetVolume;
        await active.audio.play();
        setPlaybackStatus('playing');
        return;
      }
      const nextIndex = activeDeckRef.current === 0 ? 1 : 0;
      const next = decksRef.current[nextIndex];
      next.trackId = track.id;
      next.audio.src = track.src;
      next.audio.currentTime = 0;
      next.audio.volume = immediate ? targetVolume : 0;
      await next.audio.play();
      const token = ++fadeTokenRef.current;
      activeDeckRef.current = nextIndex;
      if (immediate || active.trackId === '') {
        active.audio.pause();
        setPlaybackStatus('playing');
        return;
      }
      const started = performance.now();
      const oldVolume = active.audio.volume;
      const fade = (now: number) => {
        if (fadeTokenRef.current !== token) return;
        const progress = Math.min(1, (now - started) / 900);
        next.audio.volume = targetVolume * progress;
        active.audio.volume = oldVolume * (1 - progress);
        if (progress < 1) requestAnimationFrame(fade);
        else {
          active.audio.pause();
          setPlaybackStatus('playing');
        }
      };
      requestAnimationFrame(fade);
    } catch (error) {
      setPlaybackError(playbackMessage(error));
      setPlaybackStatus('error');
      throw error;
    }
  }, [ensureAudio, stopMusic]);

  const unlock = useCallback(async () => {
    const ctx = ensureAudio();
    const enabledSettings = { ...settingsRef.current, enabled: true };
    settingsRef.current = enabledSettings;
    setSettings(enabledSettings);
    await ctx.resume();
    // This play call deliberately stays inside the user's click stack.
    await playSceneTrack(sceneRef.current, enabledSettings, true);
    setUnlocked(true);
  }, [ensureAudio, playSceneTrack]);

  const retry = useCallback(async () => {
    setPlaybackError(undefined);
    await unlock();
  }, [unlock]);

  const setScene = useCallback((nextScene: AudioScene) => {
    sceneRef.current = nextScene;
    setSceneState(nextScene);
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    saveAudioSettings(settings);
  }, [settings]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable)) return;
      if (event.key.toLowerCase() === 'm') {
        setSettings((current) => ({ ...current, enabled: !current.enabled }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onVisibility = () => setVisibilityDucked(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    duckedRef.current = speechDucked || visibilityDucked;
    if (!unlocked) return;
    if (visibilityDucked) {
      stopMusic('paused');
      return;
    }
    void playSceneTrack(scene, settings).catch(() => undefined);
  }, [playSceneTrack, scene, settings, speechDucked, stopMusic, unlocked, visibilityDucked]);

  useEffect(() => {
    for (const source of sceneSourcesRef.current) {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    sceneSourcesRef.current = [];
    if (!unlocked || !settings.enabled || scene === 'paused' || visibilityDucked) return;
    const ctx = ensureAudio();
    const duck = speechDucked ? 0.28 : 1;
    if (settings.ambience > 0) {
      sceneSourcesRef.current.push(makeNoise(
        ctx,
        settings.ambience * (scene === 'werewolf-night' ? 0.018 : 0.009) * duck,
        scene === 'werewolf-night' ? 420 : 1050,
      ));
    }
    return () => {
      for (const source of sceneSourcesRef.current) {
        try { source.stop(); } catch { /* already stopped */ }
        source.disconnect();
      }
      sceneSourcesRef.current = [];
    };
  }, [ensureAudio, scene, settings.ambience, settings.enabled, speechDucked, unlocked, visibilityDucked]);

  useEffect(() => () => {
    fadeTokenRef.current += 1;
    decksRef.current.forEach(({ audio }) => audio.pause());
    for (const source of sceneSourcesRef.current) {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    void contextRef.current?.close();
  }, []);

  const setChannel = useCallback((channel: AudioChannel, value: number) => {
    setSettings((current) => normalizeAudioSettings({ ...current, [channel]: value }));
  }, []);
  const toggleMute = useCallback(() => {
    setSettings((current) => ({ ...current, enabled: !current.enabled }));
  }, []);
  const playEffect = useCallback((effect: TownEffect) => {
    if (!unlocked || !settings.enabled || settings.effects <= 0) return;
    const ctx = ensureAudio();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const frequencies: Record<TownEffect, number> = {
      bell: 660, reveal: 880, gavel: 150, target: 95, vote: 240,
    };
    oscillator.type = effect === 'gavel' || effect === 'target' ? 'square' : 'sine';
    oscillator.frequency.setValueAtTime(frequencies[effect], ctx.currentTime);
    gain.gain.setValueAtTime(settings.effects * 0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.42);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.45);
  }, [ensureAudio, settings.effects, settings.enabled, unlocked]);

  return (
    <TownAudioContext.Provider value={{
      settings, unlocked, scene, currentTrack: audioTrackForScene(scene), playbackStatus,
      playbackError, unlock, retry, setScene, setChannel, toggleMute,
      setDucked: setSpeechDucked, playEffect,
    }}>
      {children}
    </TownAudioContext.Provider>
  );
}

export function useTownAudio() {
  const value = useContext(TownAudioContext);
  if (!value) throw new Error('useTownAudio must be used inside TownAudioProvider.');
  return value;
}
