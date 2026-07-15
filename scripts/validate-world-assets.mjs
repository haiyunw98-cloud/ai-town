import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_RESIDENT_PHOTO_COUNT = 36;

export function validateResidentPhotoAssets(profiles, publicDir) {
  const failures = [];
  const residents = Array.isArray(profiles) ? profiles : [];
  const photoReferences = residents.flatMap((profile) =>
    Array.isArray(profile?.photos) ? profile.photos : [],
  );

  if (residents.length !== 9) {
    failures.push(`resident life profiles must contain exactly nine residents (found ${residents.length})`);
  }
  if (photoReferences.length !== EXPECTED_RESIDENT_PHOTO_COUNT) {
    failures.push(
      `resident life profiles must reference exactly ${EXPECTED_RESIDENT_PHOTO_COUNT} photos (found ${photoReferences.length})`,
    );
  }

  for (const [index, profile] of residents.entries()) {
    const residentId = profile?.id || `resident-${index + 1}`;
    const photos = Array.isArray(profile?.photos) ? profile.photos : [];
    if (photos.length !== 4 || new Set(photos).size !== 4) {
      failures.push(`${residentId} must reference four unique resident photos`);
    }

    for (const photo of photos) {
      if (typeof photo !== 'string' || !photo.endsWith('.webp')) {
        failures.push(`${residentId} resident photo must be a WebP: ${String(photo)}`);
        continue;
      }
      const relativePath = photo.replace(/^\/ai-town\//, '').replace(/^\/+/, '');
      const assetPath = resolve(publicDir, relativePath);
      if (!existsSync(assetPath)) {
        failures.push(`missing resident photo for ${residentId}: ${photo}`);
        continue;
      }
      const asset = statSync(assetPath);
      if (!asset.isFile() || asset.size === 0) {
        failures.push(`resident photo is empty for ${residentId}: ${photo}`);
      }
    }
  }

  return failures;
}

export async function validateWorldAssets(root = resolve(import.meta.dirname, '..')) {
const assetDir = resolve(root, 'public/assets/worlds/lighthouse-town');
const requiredAssets = ['tileset.svg', 'residents.svg', 'event-poster-v1.png', 'asset-sources.md'];
const failures = [];

const chineseReadme = resolve(root, 'README.zh-CN.md');
if (!existsSync(chineseReadme)) {
  failures.push('missing Chinese operations guide: README.zh-CN.md');
} else {
  const guide = readFileSync(chineseReadme, 'utf8');
  for (const requiredText of [
    'npm run dev',
    'docker compose up --build -d',
    'LLM_PROVIDER=ollama',
    'LLM_PROVIDER=openai',
    'LLM_PROVIDER=together',
    'LLM_PROVIDER=custom',
    'WORLD_LOCALE',
    'npx convex run testing:wipeAllTables',
  ]) {
    if (!guide.includes(requiredText)) failures.push(`README.zh-CN.md is missing: ${requiredText}`);
  }
}

for (const asset of requiredAssets) {
  if (!existsSync(resolve(assetDir, asset))) failures.push(`missing asset: ${asset}`);
}

const livesPath = resolve(root, 'data/worlds/lighthouse-town/lives.ts');
if (!existsSync(livesPath)) {
  failures.push('missing resident life profiles: data/worlds/lighthouse-town/lives.ts');
} else {
  const lives = await import(pathToFileURL(livesPath));
  failures.push(
    ...validateResidentPhotoAssets(lives.residentLifeProfiles, resolve(root, 'public')),
  );
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
  if (residents.width !== 384 || residents.height !== 384) {
    failures.push('residents.svg must be 384x384 for the nine 32px resident frame sets');
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
  const uniqueSpawns = new Set(map.spawnPoints.map(({ x, y }) => `${x},${y}`));
  if (map.spawnPoints.length !== 9 || uniqueSpawns.size !== 9) {
    failures.push('map must expose nine unique resident spawn points');
  }
  const requiredCheckpoints = [
    'plaza',
    'teahouse',
    'academy',
    'lotusPond',
    'dock',
    'workshop',
    'herbShop',
    'lanternShop',
  ];
  for (const name of requiredCheckpoints) {
    const checkpoint = map.eventCheckpoints?.[name];
    if (!checkpoint) {
      failures.push(`missing event checkpoint: ${name}`);
    } else if (blocked(checkpoint.x, checkpoint.y)) {
      failures.push(`event checkpoint ${name} is blocked`);
    }
  }
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

return failures;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const failures = await validateWorldAssets();
  if (failures.length) {
    console.error(`Lighthouse Town asset validation failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Lighthouse Town assets validated.');
}
