import { useEffect, useMemo, useRef, useState } from 'react';
import { selectLocalJudgeVoice } from './judgeVoice';
import { JUDGE_VOICE_ASSETS } from './judgeVoiceAssets';
import { useTownAudio } from './TownAudioProvider';

export function useJudgeVoice({
  speechKey,
  text,
  enabled,
  volume,
}: {
  speechKey: string;
  text: string;
  enabled: boolean;
  volume: number;
}) {
  const [voicesVersion, setVoicesVersion] = useState(0);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string>();
  const spokenRef = useRef<string>();
  const stopVoiceRef = useRef<() => void>();
  const { playVoiceClip } = useTownAudio();
  const speechSupported = typeof window !== 'undefined' &&
    'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const bundledSrc = JUDGE_VOICE_ASSETS[text];
  const supported = Boolean(bundledSrc) || speechSupported;
  const voice = useMemo(() => speechSupported
    ? selectLocalJudgeVoice(window.speechSynthesis.getVoices())
    : undefined, [speechSupported, voicesVersion]);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    if (!speechSupported) return;
    const refreshVoices = () => setVoicesVersion((version) => version + 1);
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    refreshVoices();
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
  }, [speechSupported]);

  useEffect(() => {
    const onVisibility = () => {
      const nextVisible = !document.hidden;
      setVisible(nextVisible);
      if (!nextVisible) {
        stopVoiceRef.current?.();
        stopVoiceRef.current = undefined;
        if (speechSupported) window.speechSynthesis.cancel();
        setSpeaking(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [speechSupported]);

  useEffect(() => {
    if (!supported || !enabled || !visible || !text || spokenRef.current === speechKey) return;
    stopVoiceRef.current?.();
    stopVoiceRef.current = undefined;
    if (speechSupported) window.speechSynthesis.cancel();
    spokenRef.current = speechKey;
    let disposed = false;

    const speakWithSystemVoice = () => {
      if (!speechSupported || disposed) {
        setError('本地法官语音暂时无法播放，字幕仍会继续。');
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 0.95;
      utterance.pitch = 1.06;
      utterance.volume = Math.max(0, Math.min(1, volume));
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.onstart = () => { setSpeaking(true); setError(undefined); };
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = (event) => {
        setSpeaking(false);
        if (event.error !== 'canceled' && event.error !== 'interrupted') {
          setError('本地法官语音暂时无法播放，字幕仍会继续。');
        }
      };
      window.speechSynthesis.speak(utterance);
    };

    if (bundledSrc) {
      void playVoiceClip(
        bundledSrc,
        volume,
        () => { if (!disposed) { setSpeaking(true); setError(undefined); } },
        () => { if (!disposed) setSpeaking(false); },
      ).then((stop) => {
        if (disposed) stop();
        else stopVoiceRef.current = stop;
      }).catch(() => speakWithSystemVoice());
    } else {
      speakWithSystemVoice();
    }
    return () => {
      disposed = true;
      stopVoiceRef.current?.();
      stopVoiceRef.current = undefined;
      if (speechSupported) window.speechSynthesis.cancel();
      setSpeaking(false);
    };
  }, [bundledSrc, enabled, playVoiceClip, speechKey, speechSupported, supported, text, visible, volume]);

  useEffect(() => () => {
    stopVoiceRef.current?.();
    if (speechSupported) window.speechSynthesis.cancel();
  }, [speechSupported]);

  return {
    supported,
    speaking,
    voiceName: bundledSrc ? '婷婷 · 内置女法官' : voice?.name ?? (supported ? '系统中文女声' : '仅字幕'),
    error,
  };
}
