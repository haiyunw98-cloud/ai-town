import { worldArtForMap } from './worldArt';
import { readFileSync } from 'node:fs';
import {
  mapheight,
  mapwidth,
  townLandmarks,
} from '../../data/worlds/lighthouse-town/map';

describe('world art selection', () => {
  test('uses the generated playable art only for Lighthouse Town', () => {
    expect(worldArtForMap('/ai-town/assets/worlds/lighthouse-town/tileset.svg')).toEqual({
      url: '/ai-town/assets/worlds/lighthouse-town/playable-map-v1.webp',
      backgroundAlpha: 1,
      objectAlpha: 0.82,
    });
    expect(worldArtForMap('/ai-town/assets/tiled/tilemap.png')).toBeUndefined();
  });

  test('renders named town institutions inside the Pixi world', () => {
    const pixiGame = readFileSync(new URL('./PixiGame.tsx', import.meta.url), 'utf8');
    const game = readFileSync(new URL('./Game.tsx', import.meta.url), 'utf8');
    const landmarkLabels = readFileSync(new URL('./TownLandmarks.tsx', import.meta.url), 'utf8');
    const landmarks = readFileSync(
      new URL('../../data/worlds/lighthouse-town/map.ts', import.meta.url),
      'utf8',
    );

    expect(pixiGame).toContain('<TownLandmarks');
    expect(pixiGame).toContain('viewport.resize(props.width, props.height');
    expect(landmarkLabels).toContain('onSelect(landmark)');
    expect(landmarkLabels).toContain('onpointerdown={() => onSelect(landmark)}');
    expect(landmarkLabels).toContain('hitArea={new PIXI.Rectangle');
    expect(game).toContain('town-landmark-card');
    expect(game).toContain('town-location-directory');
    expect(game).not.toContain('key={`${width}x${height}`}');
    expect(game).toContain('className="town-pixi-canvas"');
    expect(game).not.toContain('className="container"');
    expect(game).toContain('new ResizeObserver');
    expect(game).not.toContain('useElementSize');
    expect(game).toContain('selectedLandmark.description');
    expect(game).toContain('selectedLandmark.services.map');
    for (const name of [
      '听雨茶庄',
      '河鲜食肆',
      '镇公所',
      '灯塔书院',
      '时和卦馆',
      '苏氏机关坊',
      '白露药庐',
      '旧水码头',
      '晨雾集市',
    ]) {
      expect(landmarks).toContain(name);
    }
  });

  test('gives every institution usable services and a walkable destination', () => {
    const institutions = townLandmarks as unknown as ReadonlyArray<Record<string, any>>;
    expect(institutions).toHaveLength(9);
    expect(new Set(institutions.map((landmark) => landmark.id)).size).toBe(9);

    for (const landmark of institutions) {
      expect(landmark.description).toMatch(/[\u3400-\u9fff]/u);
      expect(landmark.services.length).toBeGreaterThanOrEqual(2);
      expect(landmark.openHours).toMatch(/时/);
      expect(landmark.destination.x).toBeGreaterThan(0);
      expect(landmark.destination.x).toBeLessThan(mapwidth - 1);
      expect(landmark.destination.y).toBeGreaterThan(0);
      expect(landmark.destination.y).toBeLessThan(mapheight - 1);
    }
  });

  test('presents landmarks as inland public places without ocean or mystery framing', () => {
    expect(JSON.stringify(townLandmarks)).not.toMatch(
      /海潮|潮汐|海风|海浪|无海航路|异常闪光|灯塔谜|机关谜|线索交汇|雾潮/u,
    );
  });
});
