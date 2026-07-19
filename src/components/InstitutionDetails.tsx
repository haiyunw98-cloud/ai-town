import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { TownLandmark } from '../../data/worlds/lighthouse-town/map';
import { institutionStatusBanner } from './runtimeViewState';

export default function InstitutionDetails({
  worldId,
  landmark,
  onClose,
}: {
  worldId: Id<'worlds'>;
  landmark: TownLandmark;
  onClose: () => void;
}) {
  const details = useQuery(api.townEconomy.institutionDetails, {
    worldId,
    institutionId: landmark.id,
  });
  const statusBanner = details && institutionStatusBanner(details);

  return (
    <section className="institution-details" aria-live="polite">
      <header className="institution-details-heading">
        <span>{landmark.icon}</span>
        <div><h2>{landmark.name}</h2><small>{landmark.openHours}</small></div>
        <button onClick={onClose} aria-label={`关闭${landmark.name}详情`}>×</button>
      </header>
      {details === undefined ? (
        <p className="institution-details-status" role="status">正在读取机构运行账本…</p>
      ) : details === null ? (
        <p className="institution-details-status">这处机构暂时无法读取。</p>
      ) : details.institutionStatus === 'unavailable' ? (
        <p className="institution-details-status">
          {statusBanner}
        </p>
      ) : (
        <>
          {statusBanner && (
            <p className="runtime-snapshot-notice">
              {statusBanner}
            </p>
          )}
          <section className="institution-purpose">
            <h3>用途介绍</h3>
            <p>{details.description}</p>
            <p>居民会在这里实际完成工作；购买会真实扣除居民金贝并减少库存，完成服务也会累加次数。</p>
          </section>

          <section>
            <h3>可使用服务</h3>
            <div className="institution-tags">
              {details.landmarkServices.map((service) => <span key={service}>{service}</span>)}
            </div>
          </section>

          <dl className="institution-metrics">
            <div><dt>机构现金</dt><dd>{liveValue(details.cash, '金贝')}</dd></div>
            <div><dt>今日收入</dt><dd>{liveValue(details.todayIncome, '金贝')}</dd></div>
            <div><dt>今日支出</dt><dd>{liveValue(details.todayExpense, '金贝')}</dd></div>
            <div><dt>今日客流</dt><dd>{liveValue(details.visitorCount, '人次')}</dd></div>
          </dl>

          <section>
            <h3>商品与库存</h3>
            {details.goods.length === 0 ? <p className="institution-empty">这里不直接售卖商品。</p> : (
              <ul className="institution-offerings">
                {details.goods.map((good) => (
                  <li key={good.id}>
                    <strong>{good.name}</strong>
                    <span>{good.price} 金贝 · {good.stock === null ? '库存初始化中' : good.stock === 0 ? '库存 0' : `库存 ${good.stock}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>服务完成量</h3>
            {details.services.length === 0 ? <p className="institution-empty">这里暂没有可累计的工作服务。</p> : (
              <ul className="institution-offerings">
                {details.services.map((service) => (
                  <li key={service.id}>
                    <strong>{service.name}</strong>
                    <span>{service.completed === null ? '完成量初始化中' : service.completed === 0 ? '完成 0 次' : `完成 ${service.completed} 次`}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="institution-ledger">
            <h3>最近经济事实</h3>
            {details.recentLedger.length === 0 ? (
              <p className="institution-empty">还没有已结算的机构事实。</p>
            ) : (
              <ol>
                {details.recentLedger.map((entry, index) => (
                  <li key={`${entry.sourceKey}:${index}`}>
                    <time>{formatRecentTime(entry.createdAt)}</time>
                    <span>{entry.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function liveValue(value: number | null, suffix: string) {
  return value === null ? '初始化中' : `${value} ${suffix}`;
}

function formatRecentTime(timestamp: number) {
  const age = Date.now() - timestamp;
  if (age < 60_000) return '刚刚';
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} 分钟前`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)} 小时前`;
  return `${Math.floor(age / 86_400_000)} 天前`;
}
