import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'react-toastify';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { WerewolfAction, WerewolfPhase, WerewolfRole } from '../../convex/werewolf/types';
import { judgeCue } from './werewolfJudge';
import { buildVenueActionCue, venueSeatPositions } from './werewolfVenueModel';
import { buildWerewolfPanelView, type WerewolfPanelState } from './werewolfView';
import { useWerewolfTheatre } from './useWerewolfTheatre';

const roleLabels: Record<WerewolfRole, string> = {
  werewolf: '狼人', villager: '平民', seer: '预言家', witch: '女巫', hunter: '猎人',
};

export default function WerewolfVenue({
  worldId,
  onClose,
}: {
  worldId: Id<'worlds'>;
  onClose: () => void;
}) {
  const snapshot = useQuery(api.werewolf.viewerState, { worldId }) as
    | WerewolfPanelState
    | null
    | undefined;
  const submitHumanAction = useMutation(api.werewolf.submitHumanAction);
  const [busy, setBusy] = useState(false);
  const [speech, setSpeech] = useState('');
  const [speed, setSpeed] = useState<1 | 2>(1);
  const view = useMemo(() => buildWerewolfPanelView(snapshot), [snapshot]);
  const names = useMemo(
    () => new Map(snapshot?.seats.map((seat) => [seat.playerId, seat.displayName]) ?? []),
    [snapshot?.seats],
  );
  const currentSpeakerName = snapshot?.speakingPlayerId
    ? names.get(snapshot.speakingPlayerId)
    : undefined;
  const theatre = useWerewolfTheatre(
    (snapshot?.phase ?? 'night-wolves') as WerewolfPhase,
    snapshot?.round ?? 1,
    speed,
    snapshot?.mode === 'observe',
  );
  const cue = useMemo(
    () => buildVenueActionCue(snapshot ? { ...snapshot, phase: theatre.presentedPhase } : {}),
    [snapshot, theatre.presentedPhase],
  );
  const judge = judgeCue({
    phase: theatre.presentedPhase,
    round: snapshot?.round ?? 1,
    speakingPlayerName: currentSpeakerName,
  });

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
    return submitHumanAction({
      sessionId: snapshot.sessionId as Id<'werewolfSessions'>,
      ...args,
    });
  };

  if (snapshot === undefined) {
    return <main className="werewolf-venue is-loading" role="status">正在布置狼人杀圆桌……</main>;
  }
  if (!snapshot) {
    return <main className="werewolf-venue is-empty"><button onClick={onClose}>← 返回小镇</button><p>当前没有狼人杀对局。</p></main>;
  }

  const points = venueSeatPositions(snapshot.seats.length);
  const pointBySeat = new Map(points.map((point) => [point.seatNumber, point]));
  const publicVotes = snapshot.publicActions.filter(
    (action): action is Extract<WerewolfAction, { kind: 'day-vote' }> => action.kind === 'day-vote',
  ).slice(-9);
  const revealRole = (playerId: string, ownRole?: WerewolfRole) =>
    snapshot.observerSecrets?.roles[playerId] ?? ownRole;

  return (
    <main className={`werewolf-venue is-${theatre.presentedPhase} theatre-speed-${speed}`}>
      <header className="werewolf-venue-toolbar">
        <button onClick={onClose}>← 缩回小镇</button>
        <div><strong>灯塔镇狼人杀会场</strong><span>第 {snapshot.round} 轮 · {theatre.catchingUp ? '法官正在主持阶段演出' : view.phaseLabel}</span></div>
        <div className="werewolf-speed-controls" aria-label="演出速度">
          <button className={speed === 1 ? 'is-active' : ''} onClick={() => setSpeed(1)}>1×</button>
          <button className={speed === 2 ? 'is-active' : ''} onClick={() => setSpeed(2)}>2×</button>
          <button onClick={theatre.skip}>跳过演出</button>
        </div>
      </header>

      <section className={`werewolf-judge tone-${judge.tone}`} aria-label="狼人杀法官">
        <span>⚖</span><div><strong>法官</strong><p>{judge.line}</p></div>
      </section>

      <section className="werewolf-stage" aria-label="九人狼人杀圆桌会场">
        <div className="werewolf-night-vignette" aria-hidden="true" />
        <div className="werewolf-round-table">
          <div className="werewolf-table-center">
            <b>{theatre.presentedPhase.startsWith('night') ? `第 ${snapshot.round} 夜` : `第 ${snapshot.round} 天`}</b>
            <span>{cue.kind === 'wolf-target' ? '🗡 ' : ''}{cue.label}</span>
            {snapshot.mode === 'observe' && snapshot.status !== 'completed' && <small>上帝观察视角</small>}
          </div>
        </div>
        <svg className="werewolf-vote-lines" viewBox="0 0 100 100" aria-hidden="true">
          {publicVotes.map((action, index) => {
            const actor = snapshot.seats.find((seat) => seat.playerId === action.actorId);
            const target = snapshot.seats.find((seat) => seat.playerId === action.targetId);
            const from = actor ? pointBySeat.get(actor.seatNumber) : undefined;
            const to = target ? pointBySeat.get(target.seatNumber) : undefined;
            return from && to ? <line key={`${action.actorId}:${action.at}:${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null;
          })}
        </svg>
        {snapshot.seats.map((seat) => {
          const point = pointBySeat.get(seat.seatNumber)!;
          const role = revealRole(seat.playerId, snapshot.viewerId === seat.playerId ? snapshot.privateRole : seat.role);
          const isWolf = snapshot.observerSecrets?.roles[seat.playerId] === 'werewolf';
          const active = cue.actorIds.includes(seat.playerId);
          const targeted = cue.targetId === seat.playerId;
          const speaking = snapshot.speakingPlayerId === seat.playerId;
          return (
            <article
              key={seat.playerId}
              className={[
                'werewolf-seat', active ? 'is-acting' : '', targeted ? 'is-targeted' : '',
                speaking ? 'is-speaking' : '', !seat.alive ? 'is-eliminated' : '',
                isWolf && theatre.presentedPhase.startsWith('night') ? 'is-awake-wolf' : '',
              ].filter(Boolean).join(' ')}
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            >
              <div className="werewolf-seat-avatar">{seat.alive ? (active ? '👁' : '😴') : '👤'}</div>
              <strong>{seat.seatNumber}号 · {seat.displayName}{snapshot.viewerId === seat.playerId ? '（你）' : ''}</strong>
              <span>{!seat.alive ? '观众席' : role ? roleLabels[role] : '身份隐藏'}</span>
              {targeted && snapshot.mode === 'observe' && <em>🗡 今夜目标</em>}
            </article>
          );
        })}
      </section>

      <aside className="werewolf-venue-log">
        {view.privateCard && (
          <details className="werewolf-private-card" open>
            <summary>你的私密身份</summary>
            <strong>{view.privateCard.roleLabel}</strong>
            <p>{view.privateCard.instructions}</p>
            {snapshot.knownWolfIds?.length ? <p>狼队：{snapshot.knownWolfIds.map((id) => names.get(id) ?? id).join('、')}</p> : null}
          </details>
        )}
        {view.controls.kind === 'speech' && (
          <section className="werewolf-human-controls">
            <label>轮到你发言 <span>{speech.length} / {view.controls.maxLength}</span></label>
            <textarea value={speech} maxLength={view.controls.maxLength} onChange={(event) => setSpeech(event.target.value)} placeholder="结合本局发言和票型，简短表达判断" />
            <button disabled={busy || !speech.trim()} onClick={() => void run(async () => {
              await submit({ kind: 'speech', text: speech.trim() });
              setSpeech('');
            })}>发送本轮发言</button>
          </section>
        )}
        {view.controls.kind === 'target' && (
          <section className="werewolf-human-controls">
            <strong>轮到你选择</strong>
            <div className="werewolf-target-grid">
              {view.controls.targets.map((targetId) => <button key={targetId} disabled={busy} onClick={() => void run(() => submit({ kind: 'target', targetId }))}>{names.get(targetId) ?? targetId}</button>)}
              {(snapshot.phase === 'day-voting' || snapshot.phase === 'runoff-voting' || snapshot.phase === 'hunter') && <button disabled={busy} onClick={() => void run(() => submit({ kind: 'target' }))}>放弃选择</button>}
            </div>
          </section>
        )}
        {view.controls.kind === 'witch' && (
          <section className="werewolf-human-controls">
            <strong>女巫行动</strong>
            {view.controls.canSave && <button disabled={busy} onClick={() => void run(() => submit({ kind: 'witch', save: true }))}>使用解药</button>}
            {view.controls.canPoison && view.controls.targets.map((targetId) => <button key={targetId} disabled={busy} onClick={() => void run(() => submit({ kind: 'witch', save: false, targetId }))}>对 {names.get(targetId) ?? targetId} 使用毒药</button>)}
            <button disabled={busy} onClick={() => void run(() => submit({ kind: 'witch', save: false }))}>今夜不用药</button>
          </section>
        )}
        <details className="werewolf-timeline" open>
          <summary>法官与公开记录（{view.publicTimeline.length}）</summary>
          <ol>
            <li className="is-judge">法官：{judge.line}</li>
            {view.publicTimeline.slice(-30).map((entry) => <li key={entry.sequence}>{entry.text}</li>)}
          </ol>
        </details>
        {snapshot.status === 'completed' && <button className="werewolf-return-button" onClick={onClose}>返回小镇继续生活</button>}
      </aside>
    </main>
  );
}
