import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { GameId } from '../../convex/aiTown/ids';
import { residentStatusBanners } from './runtimeViewState';

const statLabels = {
  mood: '心情',
  health: '健康',
  reputation: '声望',
  social: '社交',
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
  const statusBanners = residentStatusBanners(dossier);
  if (dossier.dossierStatus === 'unavailable') {
    return (
      <div className="resident-dossier-loading" role="status">
        {statusBanners.top}
      </div>
    );
  }

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
        {statusBanners.top && (
          <p className="runtime-snapshot-notice">
            {statusBanners.top}
          </p>
        )}
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

        <section className="resident-economy" aria-label="居民真实经济状况">
          <header>
            <div><span>真实生活账本</span><strong>{dossier.economy.dayKey ?? '今日'}</strong></div>
            {dossier.economy.economyStatus === 'initializing' && (
              <em>经济运行态正在初始化 · 下列职业信息来自静态档案</em>
            )}
          </header>
          <dl className="resident-economy-grid">
            <div><dt>真实金贝</dt><dd>{formatLiveValue(dossier.economy.balance, '枚')}</dd></div>
            <div><dt>今日收入</dt><dd className="is-income">{formatLiveValue(dossier.economy.todayIncome, '枚')}</dd></div>
            <div><dt>今日支出</dt><dd className="is-expense">{formatLiveValue(dossier.economy.todayExpense, '枚')}</dd></div>
            <div><dt>饥饿</dt><dd>{formatLiveValue(dossier.economy.hunger, '/ 100')}</dd></div>
            <div><dt>精力</dt><dd>{formatLiveValue(dossier.economy.energy, '/ 100')}</dd></div>
            <div className="is-wide">
              <dt>职业与机构</dt>
              <dd>{dossier.economy.occupation} · {dossier.economy.institution ?? '机构待确认'}</dd>
            </div>
          </dl>
          <p className="resident-compensation">
            {dossier.economy.compensation
              ? `报酬方式：${compensationLabel(dossier.economy.compensation.kind)}，每次完成工作应得 ${dossier.economy.compensation.amount} 金贝（以机构现金为限）`
              : '报酬约定正在确认'}
          </p>
          <div className="resident-economy-ledger">
            <h3>最近经济事实</h3>
            {dossier.economy.recentLedger.length === 0 ? (
              <p>还没有已结算的工作或购买记录。</p>
            ) : (
              <ol>
                {dossier.economy.recentLedger.map((entry, index) => (
                  <li key={`${entry.sourceKey}:${index}`}>
                    <time>{formatRecentTime(entry.createdAt)}</time>
                    <span>{entry.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

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
            {dossier.relationshipsStatus === 'initializing' && (
              <p className="dossier-empty">关系运行态正在初始化，暂不以静态印象代替实时数值。</p>
            )}
            {statusBanners.relationships && (
              <p className="dossier-empty">
                {statusBanners.relationships}
              </p>
            )}
            {dossier.relationships.map((relationship) => (
              <article key={relationship.targetId}>
                <img
                  src={relationship.targetPhoto}
                  alt={relationship.targetName}
                  loading="lazy"
                  onError={(event) => event.currentTarget.classList.add('is-missing')}
                />
                <div>
                  <header>
                    <strong>{relationship.targetName}</strong>
                    <span>{dossier.relationshipsStatus === 'live' ? '实时关系' : dossier.relationshipsStatus === 'snapshot' ? '暂停前关系' : '已载入关系'}</span>
                  </header>
                  <dl className="relation-dimensions">
                    <div><dt>友情</dt><dd>{relationship.friendship}</dd></div>
                    <div><dt>信任</dt><dd>{relationship.trust}</dd></div>
                    <div><dt>恋爱倾向</dt><dd>{relationship.attraction}</dd></div>
                    <div><dt>商业</dt><dd>{relationship.business}</dd></div>
                  </dl>
                  <div className="relation-evidence">
                    <b>最近变化依据</b>
                    {relationship.recentChanges.length === 0 ? (
                      <span>暂无变化记录，当前 0 值也会如实保留。</span>
                    ) : relationship.recentChanges.map((change) => (
                      <span key={change.sourceKey}>{change.text}</span>
                    ))}
                  </div>
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

function formatLiveValue(value: number | null, suffix: string) {
  return value === null ? '初始化中' : `${value} ${suffix}`;
}

function compensationLabel(kind: 'wage' | 'owner-draw' | 'contract-share') {
  return kind === 'wage' ? '固定工资' : kind === 'owner-draw' ? '经营者提取' : '合作订单分成';
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
