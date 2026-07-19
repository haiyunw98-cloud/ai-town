export type TownCameraMode = 'overview' | 'town' | 'island' | 'event' | 'follow';

type Point = { x: number; y: number };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function cameraFrame({
  mode,
  screenWidth,
  screenHeight,
  worldWidth,
  worldHeight,
  tileDim,
  selectedPosition,
  eventPosition,
}: {
  mode: TownCameraMode;
  screenWidth: number;
  screenHeight: number;
  worldWidth: number;
  worldHeight: number;
  tileDim: number;
  selectedPosition?: Point;
  eventPosition?: Point;
}) {
  const overviewScale = Math.min(screenWidth / worldWidth, screenHeight / worldHeight);
  const regionScale = (widthTiles: number, heightTiles: number) => clamp(
    Math.min(screenWidth / (widthTiles * tileDim), screenHeight / (heightTiles * tileDim)),
    overviewScale,
    1.5,
  );
  if (mode === 'town') {
    return { x: 20 * tileDim, y: 15 * tileDim, scale: regionScale(40, 30) };
  }
  if (mode === 'island') {
    return { x: 62 * tileDim, y: 15 * tileDim, scale: regionScale(44, 30) };
  }
  if (mode === 'event' && eventPosition) {
    return {
      x: (eventPosition.x + 0.5) * tileDim,
      y: (eventPosition.y + 0.5) * tileDim,
      scale: clamp(1.12, overviewScale, 1.5),
    };
  }
  if (mode === 'follow' && selectedPosition) {
    return {
      x: selectedPosition.x * tileDim,
      y: selectedPosition.y * tileDim,
      scale: clamp(1.45, overviewScale, 1.8),
    };
  }
  return { x: worldWidth / 2, y: worldHeight / 2, scale: overviewScale };
}
