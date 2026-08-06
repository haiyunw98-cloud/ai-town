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
  loadAudioSettings,
  normalizeAudioSettings,
  saveAudioSettings,
} from './townAudio';

type TownEffect = 'bell' | 'reveal' | 'gavel' | 'target' | 'vote';
type TownAudioApi = {
  settings: AudioSettings;
  unlocked: boolean;
  scene: AudioScene;
  unlock: () => Promise<void>;
  setScene: (scene: AudioScene) => void;
  setChannel: (channel: AudioChannel, value: number) => void;
  toggleMute: () => void;
  setDucked: (ducked: boolean) => void;
  playEffect: (effect: TownEffect) => void;
};

const TownAudioContext = createContext<TownAudioApi | null>(null);

type BrowserWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

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

function makeDrone(ctx: AudioContext, frequency: number, volume: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.value = volume;
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start();
  return oscillator;
}

export function TownAudioProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState(loadAudioSettings);
  const [unlocked, setUnlocked] = useState(false);
  const [scene, setScene] = useState<AudioScene>('town');
  const [ducked, setDucked] = useState(false);
  const contextRef = useRef<AudioContext>();
  const townTrackRef = useRef<HTMLAudioElement>();
  const sceneSourcesRef = useRef<AudioScheduledSourceNode[]>([]);

  const ensureContext = useCallback(() => {
    if (!contextRef.current) {
      const AudioContextClass = window.AudioContext ?? (window as BrowserWindow).webkitAudioContext;
      if (!AudioContextClass) throw new Error('当前浏览器不支持声音播放。');
      contextRef.current = new AudioContextClass();
    }
    if (!townTrackRef.current) {
      const track = new Audio('/ai-town/assets/background.mp3');
      track.loop = true;
      track.preload = 'auto';
      townTrackRef.current = track;
    }
    return contextRef.current;
  }, []);

  const unlock = useCallback(async () => {
    const ctx = ensureContext();
    await ctx.resume();
    setUnlocked(true);
  }, [ensureContext]);

  useEffect(() => saveAudioSettings(settings), [settings]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'm') {
        setSettings((current) => ({ ...current, enabled: !current.enabled }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onVisibility = () => setDucked(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    for (const source of sceneSourcesRef.current) {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    sceneSourcesRef.current = [];
    const townTrack = townTrackRef.current;
    if (!unlocked || !settings.enabled || scene === 'paused') {
      townTrack?.pause();
      return;
    }
    const ctx = ensureContext();
    const duck = ducked ? 0.28 : 1;
    if (scene === 'town') {
      if (townTrack) {
        townTrack.volume = settings.music * 0.55 * duck;
        void townTrack.play().catch(() => undefined);
      }
      if (settings.ambience > 0) {
        sceneSourcesRef.current.push(makeNoise(ctx, settings.ambience * 0.012 * duck, 850));
      }
      return;
    }
    townTrack?.pause();
    if (settings.music > 0) {
      const pitch = scene === 'werewolf-night' ? 73 : scene === 'werewolf-vote' ? 92 : 110;
      sceneSourcesRef.current.push(makeDrone(ctx, pitch, settings.music * 0.035 * duck));
      sceneSourcesRef.current.push(makeDrone(ctx, pitch * 1.5, settings.music * 0.016 * duck));
    }
    if (settings.ambience > 0) {
      sceneSourcesRef.current.push(makeNoise(
        ctx,
        settings.ambience * (scene === 'werewolf-night' ? 0.022 : 0.012) * duck,
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
  }, [ducked, ensureContext, scene, settings, unlocked]);

  const setChannel = useCallback((channel: AudioChannel, value: number) => {
    setSettings((current) => normalizeAudioSettings({ ...current, [channel]: value }));
  }, []);
  const toggleMute = useCallback(() => {
    setSettings((current) => ({ ...current, enabled: !current.enabled }));
  }, []);
  const playEffect = useCallback((effect: TownEffect) => {
    if (!unlocked || !settings.enabled || settings.effects <= 0) return;
    const ctx = ensureContext();
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
  }, [ensureContext, settings, unlocked]);

  return (
    <TownAudioContext.Provider value={{
      settings, unlocked, scene, unlock, setScene, setChannel, toggleMute, setDucked, playEffect,
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
