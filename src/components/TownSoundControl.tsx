import { useState } from 'react';
import type { AudioChannel } from '../audio/townAudio';
import { useTownAudio } from '../audio/TownAudioProvider';

const channels: Array<{ key: AudioChannel; label: string; icon: string }> = [
  { key: 'music', label: '音乐', icon: '♫' },
  { key: 'ambience', label: '环境', icon: '♒' },
  { key: 'effects', label: '音效', icon: '✦' },
  { key: 'voice', label: '法官', icon: '⚖' },
];

const statusLabels = {
  locked: '等待开启', loading: '正在载入', playing: '正在播放', muted: '已静音',
  paused: '已暂停', error: '播放异常',
} as const;

export default function TownSoundControl({ compact = false }: { compact?: boolean }) {
  const {
    settings, unlocked, unlock, retry, setChannel, toggleMute,
    currentTrack, playbackStatus, playbackError,
  } = useTownAudio();
  const [open, setOpen] = useState(false);
  const [unlockError, setUnlockError] = useState<string>();
  const openOrUnlock = async () => {
    if (!unlocked) {
      try {
        setUnlockError(undefined);
        await unlock();
        setOpen(true);
      } catch (error) {
        setUnlockError(error instanceof Error ? error.message : '无法开启声音');
        setOpen(true);
      }
      return;
    }
    setOpen((value) => !value);
  };
  return (
    <div className={`town-sound-control ${compact ? 'is-compact' : ''}`}>
      <button
        type="button"
        className="town-sound-trigger"
        aria-expanded={open}
        onClick={() => void openOrUnlock()}
      >
        {unlocked ? (settings.enabled ? '🔊 声音' : '🔇 已静音') : '🔇 开启声音'}
      </button>
      {open && (
        <section className="town-sound-panel" aria-label="声音设置">
          <header><strong>灯塔镇声场</strong><button onClick={() => setOpen(false)}>×</button></header>
          <div className={`town-sound-now is-${playbackStatus}`}>
            <span>当前曲目</span>
            <strong>{currentTrack.title}</strong>
            <small>{statusLabels[playbackStatus]}</small>
          </div>
          {channels.map((channel) => (
            <label key={channel.key}>
              <span>{channel.icon} {channel.label}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings[channel.key]}
                onChange={(event) => setChannel(channel.key, Number(event.target.value))}
              />
              <small>{Math.round(settings[channel.key] * 100)}%</small>
            </label>
          ))}
          <button className="town-sound-mute" onClick={toggleMute}>
            {settings.enabled ? '全部静音（M）' : '恢复声音（M）'}
          </button>
          {(playbackError || unlockError) && (
            <div className="town-sound-error" role="alert">
              <p>{playbackError ?? unlockError}</p>
              <button onClick={() => void retry().catch(() => undefined)}>重试播放</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
