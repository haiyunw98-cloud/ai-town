import { useEffect, useRef, useState } from 'react';
import PixiGame from './PixiGame.tsx';

import { Stage } from '@pixi/react';
import { ConvexProvider, useConvex, useQuery } from 'convex/react';
import PlayerDetails from './PlayerDetails.tsx';
import { api } from '../../convex/_generated/api';
import { useWorldHeartbeat } from '../hooks/useWorldHeartbeat.ts';
import { useHistoricalTime } from '../hooks/useHistoricalTime.ts';
import { DebugTimeManager } from './DebugTimeManager.tsx';
import type { GameId } from '../../convex/aiTown/ids.ts';
import { useServerGame } from '../hooks/serverGame.ts';
import EventBroadcast from './EventBroadcast.tsx';
import { useI18n } from '../i18n';
import type { TownLandmark } from '../../data/worlds/lighthouse-town/map';
import { townLandmarks } from '../../data/worlds/lighthouse-town/map';
import InstitutionDetails from './InstitutionDetails';
import type { TownCameraMode } from './cameraFrame';
import PixiRuntimeGate from './PixiRuntimeGate';

export const SHOW_DEBUG_UI = !!import.meta.env.VITE_SHOW_DEBUG_UI;

export default function Game() {
  const convex = useConvex();
  const { t } = useI18n();
  const [selectedElement, setSelectedElement] = useState<{
    kind: 'player';
    id: GameId<'players'>;
  }>();
  const [sidebarTab, setSidebarTab] = useState<'broadcast' | 'resident' | 'institution'>('broadcast');
  const [selectedLandmark, setSelectedLandmark] = useState<TownLandmark>();
  const previousSidebarTab = useRef<'broadcast' | 'resident'>('broadcast');
  const [locationDirectoryOpen, setLocationDirectoryOpen] = useState(false);
  const [observerOpen, setObserverOpen] = useState(() => window.innerWidth >= 960);
  const [cameraMode, setCameraMode] = useState<TownCameraMode>('town');
  const [gameWrapper, setGameWrapper] = useState<HTMLDivElement | null>(null);
  const [{ width, height }, setGameSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!gameWrapper) return;
    const updateSize = () => {
      const next = { width: gameWrapper.offsetWidth, height: gameWrapper.offsetHeight };
      setGameSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };
    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(gameWrapper);
    return () => resizeObserver.disconnect();
  }, [gameWrapper]);

  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const engineId = worldStatus?.engineId;

  const game = useServerGame(worldId);

  // Send a periodic heartbeat to our world to keep it alive.
  useWorldHeartbeat();

  const worldState = useQuery(api.world.worldState, worldId ? { worldId } : 'skip');
  const { historicalTime, timeManager } = useHistoricalTime(worldState?.engine);

  const scrollViewRef = useRef<HTMLDivElement>(null);

  const openInstitutionDetails = (landmark: TownLandmark) => {
    if (sidebarTab !== 'institution') previousSidebarTab.current = sidebarTab;
    setSelectedLandmark(landmark);
    setSidebarTab('institution');
    setObserverOpen(true);
    setLocationDirectoryOpen(false);
  };
  const closeInstitutionDetails = () => {
    setSelectedLandmark(undefined);
    setSidebarTab(previousSidebarTab.current);
  };

  if (!worldId || !engineId || !game) {
    return (
      <div className="town-loading" role="status">
        <img src="/ai-town/assets/worlds/lighthouse-town/playable-map-v1.webp" alt="" />
        <div>
          <span>灯</span>
          <h1>正在重连灯塔镇</h1>
          <p>居民、记忆与小镇记录都安全保存在本地。</p>
        </div>
      </div>
    );
  }
  return (
    <>
      {SHOW_DEBUG_UI && <DebugTimeManager timeManager={timeManager} width={200} height={100} />}
      <div className={`town-game-layout ${observerOpen ? '' : 'observer-closed'}`}>
        {/* Game area */}
        <div className="town-map-panel" ref={setGameWrapper}>
          <div className="town-brand" aria-label={t('app.title')}>
            <span>灯</span>
            <div>
              <h1>{t('app.title')}</h1>
              <p>{t('app.tagline')}</p>
            </div>
          </div>
          {selectedElement && (
            <div className="selected-resident-chip">
              已选择：{game.playerDescriptions.get(selectedElement.id)?.name ?? '居民'}
            </div>
          )}
          <button
            className="observer-toggle"
            onClick={() => setObserverOpen((open) => !open)}
            aria-label={observerOpen ? '扩大地图' : '打开观察台'}
          >
            {observerOpen ? '◫ 扩大地图' : '▣ 打开观察台'}
          </button>
          <div className="town-camera-controls" role="group" aria-label="地图镜头">
            {([
              ['town', '主镇'],
              ['island', '试炼岛'],
              ['overview', '全景'],
              ['event', '活动'],
              ['follow', '跟随'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={cameraMode === mode ? 'is-active' : ''}
                aria-pressed={cameraMode === mode}
                disabled={mode === 'follow' && !selectedElement}
                onClick={() => setCameraMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          {worldStatus.status === 'stoppedByDeveloper' && (
            <div className="town-pause-state" role="status">
              <strong>小镇已暂停</strong>
              <span>居民、经济、比赛与新模型请求均已休息</span>
            </div>
          )}
          <button
            className="map-live-badge"
            onClick={() => setLocationDirectoryOpen((open) => !open)}
            aria-label="查看灯塔镇地点名录"
          >
            <i /> {game.world.agents.size} 位居民正在生活 · 地点名录
          </button>
          {locationDirectoryOpen && (
            <nav className="town-location-directory" aria-label="灯塔镇地点名录">
              <header>
                <div><strong>小镇机构</strong><small>居民会实际前往并使用这些服务</small></div>
                <button onClick={() => setLocationDirectoryOpen(false)} aria-label="关闭地点名录">×</button>
              </header>
              <div>
                {townLandmarks.map((landmark) => (
                  <button
                    key={landmark.id}
                    onClick={() => openInstitutionDetails(landmark)}
                    aria-label={`查看${landmark.name}机构详情`}
                  >
                    <span>{landmark.icon}</span>
                    <div><strong>{landmark.name}</strong><small>{landmark.services.join(' · ')}</small></div>
                  </button>
                ))}
              </div>
            </nav>
          )}
          <div className="absolute inset-0">
            <div className="town-pixi-canvas">
              <Stage
                width={width}
                height={height}
                options={{ backgroundColor: 0x7ab5ff }}
              >
                {/* Re-propagate context because contexts are not shared between renderers.
https://github.com/michalochman/react-pixi-fiber/issues/145#issuecomment-531549215 */}
                <ConvexProvider client={convex}>
                  <PixiRuntimeGate worldStatus={worldStatus.status} />
                  <PixiGame
                    game={game}
                    worldId={worldId}
                    engineId={engineId}
                    width={width}
                    height={height}
                    historicalTime={historicalTime}
                    setSelectedElement={(selection) => {
                        setSelectedElement(selection);
                        if (selection) {
                          setSelectedLandmark(undefined);
                          setSidebarTab('resident');
                          setObserverOpen(true);
                        }
                    }}
                    onSelectLandmark={openInstitutionDetails}
                    cameraMode={cameraMode}
                    selectedPlayerId={selectedElement?.id}
                  />
                </ConvexProvider>
              </Stage>
            </div>
          </div>
        </div>
        {/* Right column area */}
        <aside
          className="town-observer-panel"
          ref={scrollViewRef}
        >
          <button className="observer-drawer-close" onClick={() => setObserverOpen(false)}>
            × 收起观察台
          </button>
          {sidebarTab === 'institution' && selectedLandmark && (
            <InstitutionDetails
              worldId={worldId}
              landmark={selectedLandmark}
              onClose={closeInstitutionDetails}
            />
          )}
          {sidebarTab !== 'institution' && <div className="observer-tabs" role="tablist">
            <button
              className={sidebarTab === 'broadcast' ? 'is-active' : ''}
              onClick={() => setSidebarTab('broadcast')}
              role="tab"
            >
              {t('event.broadcast')}
            </button>
            <button
              className={sidebarTab === 'resident' ? 'is-active' : ''}
              onClick={() => setSidebarTab('resident')}
              role="tab"
            >
              {t('event.resident')}
            </button>
          </div>}
          {sidebarTab === 'broadcast' ? (
            <EventBroadcast
              worldId={worldId}
                  onSelectResident={(residentId) => {
                    setSelectedElement({ kind: 'player', id: residentId });
                    setSelectedLandmark(undefined);
                    setSidebarTab('resident');
                  }}
                />
          ) : sidebarTab === 'resident' ? (
            <PlayerDetails
              worldId={worldId}
              engineId={engineId}
              game={game}
              playerId={selectedElement?.id}
              setSelectedElement={setSelectedElement}
              scrollViewRef={scrollViewRef}
            />
          ) : null}
        </aside>
      </div>
    </>
  );
}
