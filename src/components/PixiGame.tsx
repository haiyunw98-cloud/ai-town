import { useApp } from '@pixi/react';
import { Player, SelectElement } from './Player.tsx';
import { useEffect, useRef, useState } from 'react';
import { PixiStaticMap } from './PixiStaticMap.tsx';
import PixiViewport from './PixiViewport.tsx';
import { Viewport } from 'pixi-viewport';
import type { Id } from '../../convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api.js';
import { toastOnError } from '../toasts.ts';
import { DebugPath } from './DebugPath.tsx';
import { PositionIndicator } from './PositionIndicator.tsx';
import { SHOW_DEBUG_UI } from './Game.tsx';
import type { ServerGame } from '../hooks/serverGame.ts';
import TownLandmarks from './TownLandmarks.tsx';
import type { TownLandmark } from '../../data/worlds/lighthouse-town/map.ts';
import { initialViewportScale } from './viewportMath.ts';
import EventMapOverlay from './EventMapOverlay.tsx';
import FerryOverlay from './FerryOverlay.tsx';
import { buildEventOverlayState } from './eventMapOverlayModel.ts';
import { cameraFrame, type TownCameraMode } from './cameraFrame.ts';
import type { GameId } from '../../convex/aiTown/ids.ts';
import { resolveObserverDestination } from './observerDestination.ts';
import { toast } from 'react-toastify';
import WerewolfMapOverlay from './WerewolfMapOverlay.tsx';

export const PixiGame = (props: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  historicalTime: number | undefined;
  width: number;
  height: number;
  setSelectedElement: SelectElement;
  onSelectLandmark: (landmark: TownLandmark) => void;
  cameraMode: TownCameraMode;
  selectedPlayerId?: GameId<'players'>;
}) => {
  // PIXI setup.
  const pixiApp = useApp();
  const viewportRef = useRef<Viewport | undefined>();

  const humanTokenIdentifier = useQuery(api.world.userStatus, { worldId: props.worldId }) ?? null;
  const eventMapSnapshot = useQuery(api.events.eventMapSnapshot, { worldId: props.worldId });
  const werewolfSnapshot = useQuery(api.werewolf.viewerState, { worldId: props.worldId });
  const humanPlayerId = [...props.game.world.players.values()].find(
    (p) => p.human === humanTokenIdentifier,
  )?.id;

  const issueObserverCommand = useMutation(api.world.issueObserverCommand);

  // Interaction for clicking on the world to navigate.
  const dragStart = useRef<{ screenX: number; screenY: number } | null>(null);
  const onMapPointerDown = (e: any) => {
    // https://pixijs.download/dev/docs/PIXI.FederatedPointerEvent.html
    dragStart.current = { screenX: e.screenX, screenY: e.screenY };
  };

  const [lastDestination, setLastDestination] = useState<{
    x: number;
    y: number;
    t: number;
  } | null>(null);
  const onMapPointerUp = async (e: any) => {
    if (dragStart.current) {
      const { screenX, screenY } = dragStart.current;
      dragStart.current = null;
      const [dx, dy] = [screenX - e.screenX, screenY - e.screenY];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 10) {
        console.log(`Skipping navigation on drag event (${dist}px)`);
        return;
      }
    }
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const gameSpacePx = viewport.toWorld(e.screenX, e.screenY);
    const tileDim = props.game.worldMap.tileDim;
    const gameSpaceTiles = {
      x: gameSpacePx.x / tileDim,
      y: gameSpacePx.y / tileDim,
    };
    const roundedTiles = {
      x: Math.floor(gameSpaceTiles.x),
      y: Math.floor(gameSpaceTiles.y),
    };
    const selectedResident = props.selectedPlayerId
      ? props.game.world.players.get(props.selectedPlayerId)
      : undefined;
    if (!selectedResident || selectedResident.human) return;
    const destination = resolveObserverDestination(roundedTiles);
    if (!destination) {
      toast.info('请选择地图内的可到达地点；前往试炼岛会走内河渡船航线。');
      return;
    }
    setLastDestination({ t: Date.now(), ...destination });
    console.log(`Observer directs ${selectedResident.id} to ${JSON.stringify(destination)}`);
    await toastOnError((async () => {
      const inputId = await issueObserverCommand({
        worldId: props.worldId,
        engineId: props.engineId,
        residentId: selectedResident.id,
        command: 'custom',
        customDestination: destination,
      });
      return inputId;
    })());
  };
  const { width, height, tileDim } = props.game.worldMap;
  const players = [...props.game.world.players.values()].filter((player) => !player.human);
  const selectedPosition = props.selectedPlayerId
    ? props.game.world.players.get(props.selectedPlayerId)?.position
    : undefined;
  const eventPosition = buildEventOverlayState(eventMapSnapshot).activeCheckpoint;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || props.width <= 0 || props.height <= 0) return;
    const worldWidth = width * tileDim;
    const worldHeight = height * tileDim;
    const minScale = initialViewportScale(
      props.width,
      props.height,
      worldWidth,
      worldHeight,
    );
    viewport.resize(props.width, props.height, worldWidth, worldHeight);
    viewport.clampZoom({ minScale, maxScale: 3.0 });
    const frame = cameraFrame({
      mode: props.cameraMode,
      screenWidth: props.width,
      screenHeight: props.height,
      worldWidth,
      worldHeight,
      tileDim,
      selectedPosition,
      eventPosition,
    });
    viewport.animate({
      position: { x: frame.x, y: frame.y },
      scale: frame.scale,
      time: 420,
      ease: 'easeInOutSine',
      removeOnInterrupt: true,
    });
  }, [
    props.width,
    props.height,
    props.cameraMode,
    width,
    height,
    tileDim,
    selectedPosition?.x,
    selectedPosition?.y,
    eventPosition?.x,
    eventPosition?.y,
  ]);

  // Keep the full town framed after joining. The old 1.5× auto-focus hid every
  // resident outside the human spawn area and made starting conversations hard.

  return (
    <PixiViewport
      app={pixiApp}
      screenWidth={props.width}
      screenHeight={props.height}
      worldWidth={width * tileDim}
      worldHeight={height * tileDim}
      viewportRef={viewportRef}
    >
      <PixiStaticMap
        map={props.game.worldMap}
        onpointerup={onMapPointerUp}
        onpointerdown={onMapPointerDown}
      />
      <TownLandmarks tileDim={tileDim} onSelect={props.onSelectLandmark} />
      <FerryOverlay tileDim={tileDim} />
      <EventMapOverlay tileDim={tileDim} snapshot={eventMapSnapshot} />
      <WerewolfMapOverlay tileDim={tileDim} snapshot={werewolfSnapshot} />
      {players.map(
        (p) =>
          // Only show the path for the human player in non-debug mode.
          (SHOW_DEBUG_UI || p.id === humanPlayerId) && (
            <DebugPath key={`path-${p.id}`} player={p} tileDim={tileDim} />
          ),
      )}
      {lastDestination && <PositionIndicator destination={lastDestination} tileDim={tileDim} />}
      {players.map((p) => (
        <Player
          key={`player-${p.id}`}
          game={props.game}
          player={p}
          isViewer={p.id === humanPlayerId}
          onClick={props.setSelectedElement}
          historicalTime={props.historicalTime}
        />
      ))}
    </PixiViewport>
  );
};
export default PixiGame;
