export function initialViewportScale(
  screenWidth: number,
  screenHeight: number,
  worldWidth: number,
  worldHeight: number,
) {
  return 1.04 * Math.max(screenWidth / worldWidth, screenHeight / worldHeight);
}
