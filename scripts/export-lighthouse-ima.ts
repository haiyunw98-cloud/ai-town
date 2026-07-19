import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { config } from 'dotenv';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import {
  previousShanghaiDayKey,
  shanghaiDayKey,
  writeArchiveDay,
  type ObserverSnapshot,
} from './lighthouseArchive';

config({ path: resolve(process.cwd(), '.env.local') });

export const DEFAULT_IMA_ARCHIVE_DIR = join(
  homedir(),
  'Documents',
  '灯塔镇研究档案',
  'IMA导入',
);

export async function exportLighthouseArchive(options: {
  now?: number;
  days?: string[];
  root?: string;
} = {}) {
  const now = options.now ?? Date.now();
  const currentDay = shanghaiDayKey(now);
  const days = options.days ?? [previousShanghaiDayKey(currentDay), currentDay];
  const convexUrl = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  if (!convexUrl) {
    throw new Error('CONVEX_URL/VITE_CONVEX_URL is missing; start the local Lighthouse site first');
  }
  const client = new ConvexHttpClient(convexUrl);
  const status = await client.query(api.world.defaultWorldStatus, {});
  if (!status) throw new Error('Default Lighthouse world is missing');
  const root = options.root ?? process.env.LIGHTHOUSE_IMA_ARCHIVE_DIR ?? DEFAULT_IMA_ARCHIVE_DIR;
  const results = [];
  for (const dayKey of [...new Set(days)]) {
    const snapshot = await client.query(api.events.observerSnapshot, {
      worldId: status.worldId,
      dayKey,
    }) as ObserverSnapshot;
    results.push(await writeArchiveDay(root, {
      worldId: String(status.worldId),
      dayKey,
      generatedAt: now,
      snapshot,
    }));
  }
  return { root: resolve(root), worldId: String(status.worldId), days, results };
}

function parseArguments(argv: string[]) {
  const days: string[] = [];
  let root: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--day' && argv[index + 1]) days.push(argv[++index]);
    else if (argv[index] === '--output' && argv[index + 1]) root = argv[++index];
    else throw new Error(`Unknown archive argument: ${argv[index]}`);
  }
  return { ...(days.length > 0 ? { days } : {}), ...(root ? { root } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  exportLighthouseArchive(parseArguments(process.argv.slice(2)))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
