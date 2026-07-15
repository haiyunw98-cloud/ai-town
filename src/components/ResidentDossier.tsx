import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { GameId } from '../../convex/aiTown/ids';

const statLabels = {
  mood: '心情',
  energy: '精力',
  health: '健康',
  finance: '财务',
  reputation: '声望',
  social: '社交',
} as const;

const relationLabels = {
  friendship: '友情',
  crush: '心动',
  dating: '恋爱',
  business: '商业',
} as const;

const photoLabels = ['人物近照', '工作时刻', '日常生活', '社交留影'];

export default function ResidentDossier({
  worldId,
  playerId,
}: {
  worldId: Id<'worlds'>;
  playerId: GameId<'players'>;
}) {
  const dossier = useQuery(api.lives.residentDossier, { worldId, playerId });
  if (dossier === undefined) {
    return <div className="resident-dossier-loading">正在整理人生档案…</div>;
  }
  if (dossier === null) return null;

  return (
    <details
      className="resident-dossier"
      aria-label={`${dossier.profile.name}的人生档案`}
      open
    >
      <summary className="resident-dossier-summary">
        <span>人生档案</span>
        <strong>{dossier.situation}</strong>
      </summary>
      <div className="resident-dossier-content">
        <div className="resident-photo-gallery">
          <figure className="resident-featured-photo">
            <img
              src={dossier.profile.photos[0]}
              alt={`${dossier.profile.name}的${photoLabels[0]}`}
              loading="eager"
              onError={(event) => event.currentTarget.closest('figure')?.classList.add('is-missing')}
            />
            <span className="ai-photo-disclosure">AI 生成角色影像</span>
            <figcaption className="resident-photo-identity">
              <div>
                <strong>{dossier.profile.name}</strong>
                <span>{dossier.profile.occupation} · {dossier.profile.age} 岁</span>
              </div>
              <p className="resident-photo-situation">
                <span>此刻</span>
                <strong>{dossier.situation}</strong>
              </p>
            </figcaption>
          </figure>
          <div className="resident-life-thumbnails" aria-label="生活影像">
            {dossier.profile.photos.slice(1).map((photo, index) => (
              <figure key={photo}>
                <img
                  src={photo}
                  alt={`${dossier.profile.name}的${photoLabels[index + 1]}`}
                  loading="lazy"
                  onError={(event) => event.currentTarget.closest('figure')?.classList.add('is-missing')}
                />
                <figcaption>{photoLabels[index + 1]}</figcaption>
              </figure>
            ))}
          </div>
        </div>

        <div className="dossier-stats" aria-label="生活属性">
          {(Object.keys(statLabels) as Array<keyof typeof statLabels>).map((key) => (
            <div key={key}>
              <header><span>{statLabels[key]}</span><b>{dossier.stats[key]}</b></header>
              <i><em style={{ width: `${dossier.stats[key]}%` }} /></i>
            </div>
          ))}
        </div>

        <DossierSection title="人生资料">
          <dl className="dossier-facts">
            <div><dt>年龄</dt><dd>{dossier.profile.age} 岁（成年）</dd></div>
            <div><dt>职业</dt><dd>{dossier.profile.occupation}</dd></div>
            <div><dt>住处</dt><dd>{dossier.profile.home}</dd></div>
            <div><dt>今日穿着</dt><dd>{dossier.profile.outfit}</dd></div>
            <div><dt>饮食习惯</dt><dd>{dossier.profile.diet}</dd></div>
            <div><dt>生意与收入</dt><dd>{dossier.profile.business}</dd></div>
            <div><dt>当前目标</dt><dd>{dossier.profile.currentGoal}</dd></div>
          </dl>
          <div className="personality-tags">
            {dossier.profile.personality.map((trait) => <span key={trait}>{trait}</span>)}
          </div>
        </DossierSection>

        <DossierSection title="社会关系">
          <div className="dossier-relations">
            {dossier.relationships.map((relationship, index) => (
              <article className={`relation-${relationship.kind}`} key={`${relationship.targetId}:${relationship.kind}:${index}`}>
                <img
                  src={relationship.targetPhoto}
                  alt=""
                  loading="lazy"
                  onError={(event) => event.currentTarget.classList.add('is-missing')}
                />
                <div>
                  <header>
                    <strong>{relationship.targetName}</strong>
                    <span>{relationLabels[relationship.kind]} · {relationship.label}</span>
                  </header>
                  <p>{relationship.summary}</p>
                  <i><em style={{ width: `${relationship.score}%` }} /></i>
                </div>
              </article>
            ))}
          </div>
        </DossierSection>

        <DossierSection title="最近发生">
          <ol className="dossier-timeline">
            {dossier.recentEvents.map((event, index) => (
              <li key={`${event.createdAt}:${index}`}>
                <time>{event.createdAt === null ? (event.kind === 'memory' ? '档案记录' : '此刻') : formatRecentTime(event.createdAt)}</time>
                <p>{event.text}</p>
              </li>
            ))}
          </ol>
        </DossierSection>
      </div>
    </details>
  );
}

function DossierSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="dossier-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function formatRecentTime(timestamp: number) {
  const age = Date.now() - timestamp;
  if (age < 60_000) return '刚刚';
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} 分钟前`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)} 小时前`;
  return `${Math.floor(age / 86_400_000)} 天前`;
}
