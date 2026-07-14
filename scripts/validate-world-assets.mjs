import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const assetDir = resolve(root, 'public/assets/worlds/lighthouse-town');
const requiredAssets = ['tileset.svg', 'residents.svg', 'asset-sources.md'];
const failures = [];

for (const asset of requiredAssets) {
  if (!existsSync(resolve(assetDir, asset))) failures.push(`missing asset: ${asset}`);
}

function svgSize(filename) {
  const source = readFileSync(resolve(assetDir, filename), 'utf8');
  const match = source.match(/<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
  if (!match) throw new Error(`${filename} must declare numeric width and height`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

if (failures.length === 0) {
  const tileset = svgSize('tileset.svg');
  const residents = svgSize('residents.svg');
  if (tileset.width % 32 || tileset.height % 32) {
    failures.push('tileset.svg dimensions must be multiples of 32');
  }
  if (residents.width !== 384 || residents.height !== 256) {
    failures.push('residents.svg must be 384x256 for the existing 32px frame metadata');
  }
}

const mapPath = resolve(root, 'data/worlds/lighthouse-town/map.ts');
if (!existsSync(mapPath)) {
  failures.push('missing map module: data/worlds/lighthouse-town/map.ts');
} else {
  const map = await import(pathToFileURL(mapPath));
  for (const [kind, layers] of [
    ['background', map.bgtiles],
    ['object', map.objmap],
  ]) {
    for (const [index, layer] of layers.entries()) {
      if (layer.length !== map.mapwidth || layer.some((column) => column.length !== map.mapheight)) {
        failures.push(`${kind} layer ${index} dimensions do not match map width and height`);
      }
    }
  }

  const tileCount = (map.tilesetpxw / map.tiledim) * (map.tilesetpxh / map.tiledim);
  for (const layer of [...map.bgtiles, ...map.objmap]) {
    for (const column of layer) {
      for (const tile of column) {
        if (tile < -1 || tile >= tileCount) failures.push(`tile index ${tile} is out of bounds`);
      }
    }
  }

  const blocked = (x, y) => map.objmap.some((layer) => layer[x][y] !== -1);
  const targetKey = `${map.lighthousePlaza.x},${map.lighthousePlaza.y}`;
  for (const spawn of map.spawnPoints) {
    const queue = [spawn];
    const visited = new Set([`${spawn.x},${spawn.y}`]);
    while (queue.length) {
      const current = queue.shift();
      for (const next of [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 },
      ]) {
        const key = `${next.x},${next.y}`;
        if (
          next.x < 0 ||
          next.y < 0 ||
          next.x >= map.mapwidth ||
          next.y >= map.mapheight ||
          blocked(next.x, next.y) ||
          visited.has(key)
        ) continue;
        visited.add(key);
        queue.push(next);
      }
    }
    if (!visited.has(targetKey)) failures.push(`spawn ${spawn.x},${spawn.y} cannot reach lighthouse`);
  }
}

if (failures.length) {
  console.error(`Lighthouse Town asset validation failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('Lighthouse Town assets validated.');
