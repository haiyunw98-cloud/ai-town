import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'react-toastify';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { buildWerewolfPanelView, type WerewolfPanelState } from './werewolfView';

export default function WerewolfPanel({ worldId }: { worldId: Id<'worlds'> }) {
  const snapshot = useQuery(api.werewolf.viewerState, { worldId }) as
    | WerewolfPanelState
    | null
    | undefined;
  const startSession = useMutation(api.werewolf.startSession);
  const submitAction = useMutation(api.werewolf.submitHumanAction);
  const [busy, setBusy] = useState(false);
  const [speech, setSpeech] = useState('');
  const view = useMemo(() => buildWerewolfPanelView(snapshot), [snapshot]);

  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '狼人杀操作失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };
  const submit = (args: {
    kind: 'speech' | 'target' | 'witch'; text?: string; targetId?: string; save?: boolean;
  }) => {
    if (!snapshot?.sessionId) return Promise.resolve();
    return submitAction({ sessionId: snapshot.sessionId as Id<'werewolfSessions'>, ...args });
  };
  const residentName = (playerId: string) =>
    snapshot?.seats.find((seat) => seat.playerId === playerId)?.displayName ?? playerId;

  if (snapshot === undefined) {
    return <section className="werewolf-panel is-loading">正在读取狼人杀圆桌……</section>;
  }
  return (
    <section className="werewolf-panel" aria-label="灯塔镇九人狼人杀">
      <header>
        <div><small>居民社交游戏</small><h3>{view.title}</h3></div>
        <span>{view.roundLabel}</span>
      </header>
      <div className="werewolf-phase"><b>{view.phaseLabel}</b><em>安全离场 · 无人受伤</em></div>
      {view.canStart && (
        <div className="werewolf-start-actions">
          <button disabled={busy} onClick={() => void run(() => startSession({ worldId, mode: 'observe' }))}>
            👁 {view.startLabels[0]}
          </button>
          <button disabled={busy} onClick={() => void run(() => startSession({ worldId, mode: 'play' }))}>
            🎭 {view.startLabels[1]}
          </button>
        </div>
      )}
      {view.privateCard && (
        <details className="werewolf-private-card">
          <summary>你的私密身份卡（点击查看）</summary>
          <strong>{view.privateCard.roleLabel}</strong>
          <p>{view.privateCard.instructions}</p>
          {snapshot?.knownWolfIds && <p>狼队：{snapshot.knownWolfIds.map(residentName).join('、')}</p>}
          {snapshot?.seerResults?.length ? (
            <ul>{snapshot.seerResults.map((result) => (
              <li key={result.targetId}>{residentName(result.targetId)}：{result.camp === 'wolves' ? '狼人' : '好人'}</li>
            ))}</ul>
          ) : null}
        </details>
      )}
      {view.controls.kind === 'speech' && (
        <div className="werewolf-human-controls">
          <label>轮到你发言 <span>{speech.length} / {view.controls.maxLength}</span></label>
          <textarea
            value={speech}
            maxLength={view.controls.maxLength}
            onChange={(event) => setSpeech(event.target.value)}
            placeholder="短句、多轮，结合本局发言和票型判断"
          />
          <button disabled={busy || !speech.trim()} onClick={() => void run(async () => {
            await submit({ kind: 'speech', text: speech.trim() });
            setSpeech('');
          })}>发送本轮发言</button>
        </div>
      )}
      {view.controls.kind === 'target' && (
        <div className="werewolf-human-controls">
          <strong>轮到你选择</strong>
          <div className="werewolf-target-grid">
            {view.controls.targets.map((targetId) => (
              <button key={targetId} disabled={busy} onClick={() => void run(() => submit({ kind: 'target', targetId }))}>
                {residentName(targetId)}
              </button>
            ))}
            {(snapshot?.phase === 'day-voting' || snapshot?.phase === 'runoff-voting' || snapshot?.phase === 'hunter') && (
              <button disabled={busy} onClick={() => void run(() => submit({ kind: 'target' }))}>放弃选择</button>
            )}
          </div>
        </div>
      )}
      {view.controls.kind === 'witch' && (
        <div className="werewolf-human-controls">
          <strong>女巫行动</strong>
          {view.controls.canSave && (
            <button disabled={busy} onClick={() => void run(() => submit({ kind: 'witch', save: true }))}>
              使用解药救下今夜目标
            </button>
          )}
          {view.controls.canPoison && view.controls.targets.map((targetId) => (
            <button key={targetId} disabled={busy} onClick={() => void run(() => submit({
              kind: 'witch', save: false, targetId,
            }))}>对 {residentName(targetId)} 使用毒药</button>
          ))}
          <button disabled={busy} onClick={() => void run(() => submit({ kind: 'witch', save: false }))}>今夜不用药</button>
        </div>
      )}
      {snapshot && (
        <details className="werewolf-timeline" open>
          <summary>本局公开记录（{view.publicTimeline.length}）</summary>
          {view.publicTimeline.length === 0 ? <p>等待第一条公开发言……</p> : (
            <ol>{view.publicTimeline.slice(-30).map((entry) => <li key={entry.sequence}>{entry.text}</li>)}</ol>
          )}
        </details>
      )}
    </section>
  );
}
