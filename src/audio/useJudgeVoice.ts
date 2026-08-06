import { useEffect, useMemo, useRef, useState } from 'react';
import { selectLocalJudgeVoice } from './judgeVoice';

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
  const supported = typeof window !== 'undefined' &&
    'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const voice = useMemo(() => supported
    ? selectLocalJudgeVoice(window.speechSynthesis.getVoices())
    : undefined, [supported, voicesVersion]);

  useEffect(() => {
    if (!supported) return;
    const refreshVoices = () => setVoicesVersion((version) => version + 1);
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    refreshVoices();
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
  }, [supported]);

  useEffect(() => {
    const onVisibility = () => {
      const nextVisible = !document.hidden;
      setVisible(nextVisible);
      if (!nextVisible && supported) {
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [supported]);

  useEffect(() => {
    if (!supported || !enabled || !visible || !text || spokenRef.current === speechKey) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.95;
    utterance.pitch = 1.06;
    utterance.volume = Math.max(0, Math.min(1, volume));
    if (voice) utterance.voice = voice;
    utterance.onstart = () => { setSpeaking(true); setError(undefined); };
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = (event) => {
      setSpeaking(false);
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        setError('本地法官语音暂时无法播放，字幕仍会继续。');
      }
    };
    spokenRef.current = speechKey;
    window.speechSynthesis.speak(utterance);
    return () => {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    };
  }, [enabled, speechKey, supported, text, visible, voice, volume]);

  useEffect(() => () => {
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  return {
    supported,
    speaking,
    voiceName: voice?.name ?? (supported ? '系统中文女声' : '仅字幕'),
    error,
  };
}
