import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { useI18n } from '../i18n';
import type { Locale } from '../i18n';
import {
  buildBroadcastView,
  buildCompletedArchiveView,
  buildTownStory,
  shanghaiDayKey,
  type BroadcastSnapshot,
} from './eventBroadcastView';
import {
  buildReportActionsView,
  exportFactualReport,
  getSocialReportExportStore,
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
  const [now, setNow] = useState(Date.now());
  const snapshot = useQuery(api.events.observerSnapshot, {
    worldId,
    dayKey: shanghaiDayKey(now),
  }) as
    | BroadcastSnapshot
    | undefined;
  const generateSocialObservation = useAction(api.socialObservations.generate);
  const socialReportStore = getSocialReportExportStore(worldId);
  const socialReportPending = useSyncExternalStore(
    socialReportStore.subscribe,
    socialReportStore.getSnapshot,
    socialReportStore.getSnapshot,
  );
  const reportActions = buildReportActionsView(socialReportPending);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!snapshot) {
    return <div className="event-empty">{t('event.loading')}</div>;
  }
  const view = buildBroadcastView(snapshot, locale, now);
  const story = buildTownStory(snapshot.conversations);
  const exportFacts = () => {
    exportFactualReport({ snapshot, locale, exportNow: Date.now() });
  };
  const exportSocialObservation = () => socialReportStore.run({
    snapshot,
    locale,
    exportNow: Date.now(),
    generate: generateSocialObservation,
  });
  return (
    <section className="event-broadcast" aria-label={view.title}>
      <div className="daily-report-export">
        <div>
          <strong>灯塔镇双日报</strong>
          <small>人物、关系、地点、活动与原始对话</small>
        </div>
        <div className="daily-report-actions">
          <button onClick={exportFacts}>{reportActions.factualLabel}</button>
          <button
            onClick={() => void exportSocialObservation()}
            disabled={reportActions.socialDisabled}
            aria-busy={reportActions.socialBusy}
          >
            {reportActions.socialLabel}
          </button>
          <span className="report-status-live" aria-live="polite" aria-atomic="true">
            {reportActions.liveStatus}
          </span>
        </div>
      </div>
      {view.presentation === 'live' && snapshot.event && (
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
              <span>{view.live.phaseLabel}</span>
              <strong>{view.live.countdown}</strong>
            </div>
          </div>
          <p className="event-prize"><span>◆</span> {snapshot.event.prize}</p>
          {view.winnerName && (
            <div className="event-winner">{t('event.winner', { name: view.winnerName })}</div>
          )}
        </>
      )}

      <div className="town-story">
        <span className="event-kicker">观察者速报 · 自动归纳</span>
        <h3>{story.headline}</h3>
        {story.bullets.length === 0 ? (
          <p className="event-empty">暂无新的日常记录</p>
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

      {view.presentation === 'live' && snapshot.event && (
        <details className="event-scoreboard" open>
          <summary>
            <div className="event-section-title">
              <h3>{t('event.rankings')}</h3>
              <span>{t('event.remaining', { count: view.live.activeCount })}</span>
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

      {view.presentation !== 'history' && (
        <div className="event-chronicle">
          <div className="event-section-title">
            <h3>{view.mode === 'event' ? t('event.chronicle') : view.title}</h3>
            <span>{t('event.localRecords')}</span>
          </div>
          {snapshot.logs.length === 0 && <p className="event-empty">{t('event.noEntries')}</p>}
          {snapshot.logs.map((entry) => (
            <article className="event-log-entry" key={`${entry.eventKey}:${entry.sequence}:${entry.createdAt}`}>
              <time>{formatTime(entry.createdAt, locale)}</time>
              <p>{entry.text}</p>
            </article>
          ))}
        </div>
      )}

      {view.presentation === 'history' && (
        <CompletedEventArchive
          locale={locale}
          title={view.title}
          emptyLabel={t('event.noEntries')}
          history={view.history}
        />
      )}
    </section>
  );
}

function CompletedEventArchive({
  locale,
  title,
  emptyLabel,
  history,
}: {
  locale: Locale;
  title: string;
  emptyLabel: string;
  history: {
    eventName: string;
    champion: string;
    prize: string;
    result: string;
    logs: BroadcastSnapshot['logs'];
  };
}) {
  const archive = buildCompletedArchiveView(title, history.champion, locale);
  const initialDisclosure = archive.expandedByDefault ? { open: true } : {};
  return (
    <details className="event-history-card" {...initialDisclosure}>
      <summary>
        <span>
          <small>{archive.contextLabel}</small>
          <strong>{archive.title}</strong>
        </span>
        <em>{archive.winnerSummary}</em>
      </summary>
      <div className="event-history-body">
        <dl className="event-history-facts">
          <div><dt>{locale === 'zh-CN' ? '活动' : 'Event'}</dt><dd>{history.eventName}</dd></div>
          <div><dt>{locale === 'zh-CN' ? '冠军' : 'Champion'}</dt><dd>{history.champion}</dd></div>
          <div><dt>{locale === 'zh-CN' ? '奖品' : 'Prize'}</dt><dd>{history.prize}</dd></div>
          <div><dt>{locale === 'zh-CN' ? '最终结果' : 'Final result'}</dt><dd>{history.result}</dd></div>
        </dl>
        <div className="event-history-log">
          <h3>{locale === 'zh-CN' ? '历史过程记录' : 'Event record'}</h3>
          {history.logs.length === 0 ? (
            <p className="event-empty">{emptyLabel}</p>
          ) : (
            <ol>
              {history.logs.map((entry) => (
                <li key={`${entry.eventKey}:${entry.sequence}:${entry.createdAt}`}>
                  <time>{formatTime(entry.createdAt, locale)}</time>
                  <p>{entry.text}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </details>
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
