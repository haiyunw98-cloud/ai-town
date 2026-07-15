import { useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { Locale, useI18n } from '../i18n';
import { BroadcastSnapshot, buildBroadcastView } from './eventBroadcastView';

export default function EventBroadcast({ worldId }: { worldId: Id<'worlds'> }) {
  const { locale, t } = useI18n();
  const snapshot = useQuery(api.events.observerSnapshot, { worldId }) as
    | BroadcastSnapshot
    | undefined;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!snapshot) {
    return <div className="event-empty">{t('event.loading')}</div>;
  }
  const view = buildBroadcastView(snapshot, locale, now);
  return (
    <section className="event-broadcast" aria-label={view.title}>
      {view.mode === 'event' && snapshot.event && (
        <>
          {snapshot.event.phase === 'announcement' && (
            <div className="event-poster">
              <img
                src="/ai-town/assets/worlds/lighthouse-town/event-poster-v1.png"
                alt=""
              />
              <div className="event-poster-copy">
                <span>{t('event.specialBroadcast')}</span>
                <strong>{snapshot.event.name}</strong>
              </div>
            </div>
          )}
          <div className="event-heading lantern-glow">
            <div>
              <span className="event-kicker">{t('event.live')}</span>
              <h2>{view.title}</h2>
            </div>
            <div className="event-clock" aria-label={t('event.countdown')}>
              <span>{view.phaseLabel}</span>
              <strong>{snapshot.event.status === 'completed' ? t('event.finished') : view.countdown}</strong>
            </div>
          </div>
          <p className="event-prize"><span>◆</span> {snapshot.event.prize}</p>
          {view.winnerName && (
            <div className="event-winner">{t('event.winner', { name: view.winnerName })}</div>
          )}
          <div className="event-scoreboard">
            <div className="event-section-title">
              <h3>{t('event.rankings')}</h3>
              <span>{t('event.remaining', { count: view.activeCount })}</span>
            </div>
            {snapshot.participants.map((participant, index) => (
              <article
                className={`event-score-row ${participant.active ? '' : 'is-eliminated'}`}
                key={participant.residentId}
              >
                <b>{participant.rank ?? index + 1}</b>
                <div>
                  <strong>{participant.displayName}</strong>
                  <small>{participant.quote ?? roleLabel(participant.role, locale)}</small>
                </div>
                <span>{participant.shells} ◇</span>
                <em>{participant.score}</em>
              </article>
            ))}
          </div>
        </>
      )}
      <div className="event-chronicle">
        <div className="event-section-title">
          <h3>{view.mode === 'event' ? t('event.chronicle') : view.title}</h3>
          <span>{t('event.localRecords')}</span>
        </div>
        {snapshot.logs.length === 0 && <p className="event-empty">{t('event.noEntries')}</p>}
        {snapshot.logs.map((entry) => (
          <article className="event-log-entry" key={entry.eventKey}>
            <time>{formatTime(entry.createdAt, locale)}</time>
            <p>{entry.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function roleLabel(role: string, locale: Locale) {
  const chinese: Record<string, string> = {
    competitor: '参赛中',
    commentator: '赛事评论员',
    helper: '场外助手',
    interferer: '神秘干扰者',
    winner: '冠军',
  };
  const english: Record<string, string> = {
    competitor: 'Competing',
    commentator: 'Commentator',
    helper: 'Helper',
    interferer: 'Interferer',
    winner: 'Winner',
  };
  return (locale === 'zh-CN' ? chinese : english)[role] ?? role;
}

function formatTime(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(timestamp);
}
