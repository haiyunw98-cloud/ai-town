import { useEffect, useRef, useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { useI18n } from '../i18n';
import type { Locale } from '../i18n';
import {
  buildBroadcastView,
  buildTownStory,
  type BroadcastSnapshot,
} from './eventBroadcastView';
import {
  exportFactualReport,
  exportSocialReport,
} from './reportExportController';
import type { GameId } from '../../convex/aiTown/ids';

export default function EventBroadcast({
  worldId,
  onSelectResident,
}: {
  worldId: Id<'worlds'>;
  onSelectResident?: (residentId: GameId<'players'>) => void;
}) {
  const { locale, t } = useI18n();
  const snapshot = useQuery(api.events.observerSnapshot, { worldId }) as
    | BroadcastSnapshot
    | undefined;
  const generateSocialObservation = useAction(api.socialObservations.generate);
  const [now, setNow] = useState(Date.now());
  const [socialReportPending, setSocialReportPending] = useState(false);
  const socialReportPendingRef = useRef(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!snapshot) {
    return <div className="event-empty">{t('event.loading')}</div>;
  }
  const view = buildBroadcastView(snapshot, locale, now);
  const story = buildTownStory(snapshot.conversations);
  const eventCompleted = snapshot.event?.status === 'completed';
  const exportFacts = () => {
    exportFactualReport({ snapshot, locale, exportNow: Date.now() });
  };
  const exportSocialObservation = () => exportSocialReport(socialReportPendingRef, {
    snapshot,
    locale,
    exportNow: Date.now(),
    generate: generateSocialObservation,
    setPending: setSocialReportPending,
  });
  return (
    <section className="event-broadcast" aria-label={view.title}>
      <div className="daily-report-export">
        <div>
          <strong>灯塔镇双日报</strong>
          <small>人物、关系、地点、活动与原始对话</small>
        </div>
        <div className="daily-report-actions">
          <button onClick={exportFacts}>导出事实流水账</button>
          <button
            onClick={() => void exportSocialObservation()}
            disabled={socialReportPending}
            aria-busy={socialReportPending}
          >
            {socialReportPending ? '正在整理社会观察' : '生成社会观察日志'}
          </button>
        </div>
      </div>
      {view.mode === 'event' && snapshot.event && (
        <>
          {!eventCompleted && (
            <>
              <div className="event-poster event-poster-compact">
                <img
                  src="/ai-town/assets/worlds/lighthouse-town/event-poster-v1.png"
                  alt=""
                />
                <div className="event-poster-copy">
                  <span>{t('event.specialBroadcast')}</span>
                  <strong>{snapshot.event.name}</strong>
                </div>
                <div className="event-live-dot">LIVE</div>
              </div>
              <div className="event-heading lantern-glow">
                <div>
                  <span className="event-kicker">{t('event.live')}</span>
                  <h2>{view.title}</h2>
                </div>
                <div className="event-clock" aria-label={t('event.countdown')}>
                  <span>{view.phaseLabel}</span>
                  <strong>{view.countdown}</strong>
                </div>
              </div>
              <p className="event-prize"><span>◆</span> {snapshot.event.prize}</p>
            </>
          )}
          {eventCompleted && (
            <details className="event-recap">
              <summary>
                <span>上届活动回顾</span>
                <strong>{view.winnerName ? `${view.winnerName} 获胜` : snapshot.event.name}</strong>
              </summary>
              <p>{snapshot.event.prize}</p>
            </details>
          )}
          {view.winnerName && !eventCompleted && (
            <div className="event-winner">{t('event.winner', { name: view.winnerName })}</div>
          )}
        </>
      )}

      <div className="town-story">
        <span className="event-kicker">观察者速报 · 自动归纳</span>
        <h3>{story.headline}</h3>
        {story.bullets.length === 0 ? (
          <p className="event-empty">居民正在生活，新的故事线形成后会出现在这里。</p>
        ) : (
          <ul>
            {story.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
          </ul>
        )}
      </div>

      <div className="resident-activity">
        <div className="event-section-title">
          <h3>{snapshot.residentActivity.length} 人此刻</h3>
          <span>实时生活状态</span>
        </div>
        <div className="resident-activity-grid">
          {snapshot.residentActivity.map((resident) => (
            <button
              key={resident.residentId}
              onClick={() => onSelectResident?.(resident.residentId as GameId<'players'>)}
              aria-label={`查看 ${resident.displayName} 并与其交谈`}
            >
              <i className={resident.status.includes('交谈') || resident.status.includes('发言') ? 'is-talking' : ''} />
              <div>
                <strong>{resident.displayName}</strong>
                <small>{resident.status} · {resident.detail}</small>
              </div>
            </button>
          ))}
        </div>
      </div>

      {view.mode === 'event' && snapshot.event && (
        <details className="event-scoreboard" open={!eventCompleted}>
          <summary>
            <div className="event-section-title">
              <h3>{t('event.rankings')}</h3>
              <span>{t('event.remaining', { count: view.activeCount })}</span>
            </div>
          </summary>
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
        </details>
      )}

      <div className="town-conversations">
        <div className="event-section-title">
          <h3>居民对话与归纳</h3>
          <span>{snapshot.conversations.length} 条故事线</span>
        </div>
        {snapshot.conversations.map((conversation) => (
          <article className="town-conversation" key={conversation.conversationId}>
            <header>
              <strong>{conversation.participantNames.join(' × ')}</strong>
              <time>{formatTime(conversation.updatedAt, locale)}</time>
            </header>
            <p>{conversation.summary}</p>
            <details>
              <summary>展开原始对话（{conversation.messages.length}）</summary>
              <div className="town-dialogue-list">
                {conversation.messages.map((message, index) => (
                  <div key={`${message.createdAt}:${index}`}>
                    <b>{message.authorName}</b>
                    <span>{cleanForDisplay(message.text)}</span>
                  </div>
                ))}
              </div>
            </details>
          </article>
        ))}
      </div>

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

function cleanForDisplay(text: string) {
  return text.replace(/（[^）]*）/g, ' ').replace(/\s+/g, ' ').trim();
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
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai',
  }).format(timestamp);
}
