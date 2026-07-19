import { cameraFrame } from './cameraFrame';

const base = {
  screenWidth: 1200,
  screenHeight: 800,
  worldWidth: 84 * 32,
  worldHeight: 30 * 32,
  tileDim: 32,
};

describe('town camera frames', () => {
  test('frames the entire expanded world without blank gutters', () => {
    expect(cameraFrame({ mode: 'overview', ...base })).toEqual({
      x: 42 * 32,
      y: 15 * 32,
      scale: 1200 / (84 * 32),
    });
  });

  test('centers the original town and Trial Island as separate readable regions', () => {
    const town = cameraFrame({ mode: 'town', ...base });
    const island = cameraFrame({ mode: 'island', ...base });
    expect(town.x).toBe(20 * 32);
    expect(island.x).toBe(62 * 32);
    expect(town.scale).toBeGreaterThan(1200 / (84 * 32));
    expect(island.scale).toBeGreaterThan(1200 / (84 * 32));
  });

  test('tracks a live event checkpoint or selected resident with a close view', () => {
    expect(cameraFrame({
      mode: 'event', ...base, eventPosition: { x: 75, y: 12 },
    })).toEqual({ x: 75.5 * 32, y: 12.5 * 32, scale: 1.12 });
    expect(cameraFrame({
      mode: 'follow', ...base, selectedPosition: { x: 6.5, y: 9 },
    })).toEqual({ x: 6.5 * 32, y: 9 * 32, scale: 1.45 });
  });

  test('falls back to overview when event or resident target is unavailable', () => {
    expect(cameraFrame({ mode: 'event', ...base })).toEqual(
      cameraFrame({ mode: 'overview', ...base }),
    );
    expect(cameraFrame({ mode: 'follow', ...base })).toEqual(
      cameraFrame({ mode: 'overview', ...base }),
    );
  });
});
