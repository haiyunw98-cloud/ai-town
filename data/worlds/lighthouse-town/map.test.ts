import * as townMap from './map';
import { dailyEventTemplates } from '../../../convex/events/dailyTemplates';

function stableHash(value: unknown) {
  let hash = 2166136261;
  for (const character of JSON.stringify(value)) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

describe('expanded lighthouse town world map', () => {
  test('preserves the original forty-column town exactly while extending the world', () => {
    const map = townMap as typeof townMap & { TOWN_WIDTH?: number };
    expect(map.TOWN_WIDTH).toBe(40);
    expect(map.mapwidth).toBe(84);
    expect(map.mapheight).toBe(30);
    expect(stableHash(map.bgtiles.map((layer) => layer.slice(0, 40)))).toBe(1776384495);
    expect(stableHash(map.objmap.map((layer) => layer.slice(0, 40)))).toBe(1799884763);
    expect(map.spawnPoints).toEqual([
      { x: 5, y: 12 }, { x: 15, y: 12 }, { x: 27, y: 12 },
      { x: 35, y: 12 }, { x: 5, y: 24 }, { x: 15, y: 24 },
      { x: 27, y: 24 }, { x: 35, y: 24 }, { x: 22, y: 25 },
    ]);
  });

  test('keeps the eight-column river blocked and the trial island enclosed', () => {
    for (let x = 40; x <= 47; x += 1) {
      for (let y = 0; y < townMap.mapheight; y += 1) {
        expect(townMap.objmap[0][x][y]).not.toBe(-1);
      }
    }
    for (let y = 0; y < townMap.mapheight; y += 1) {
      expect(townMap.objmap[0][83][y]).not.toBe(-1);
    }
  });

  test('exports a walkable checkpoint for every daily event stage and ferry endpoint', () => {
    const map = townMap as typeof townMap & {
      trialIslandCheckpoints?: Record<string, { x: number; y: number }>;
      dailyEventCheckpointById?: (id: string) => { x: number; y: number };
    };
    expect(map.trialIslandCheckpoints).toBeDefined();
    expect(map.dailyEventCheckpointById).toBeDefined();
    const required = new Set(
      dailyEventTemplates.flatMap((template) =>
        template.stages.flatMap((stage) => stage.checkpoints),
      ),
    );
    required.add('island-arrival');
    required.add('island-spectator-stand');
    for (const checkpointId of required) {
      const checkpoint = map.dailyEventCheckpointById?.(checkpointId);
      expect(checkpoint).toBeDefined();
      expect(Number.isInteger(checkpoint!.x)).toBe(true);
      expect(Number.isInteger(checkpoint!.y)).toBe(true);
      expect(checkpoint!.x).toBeGreaterThanOrEqual(0);
      expect(checkpoint!.x).toBeLessThan(townMap.mapwidth);
      expect(checkpoint!.y).toBeGreaterThanOrEqual(0);
      expect(checkpoint!.y).toBeLessThan(townMap.mapheight);
      expect(townMap.objmap[0][checkpoint!.x][checkpoint!.y]).toBe(-1);
    }
  });
});
