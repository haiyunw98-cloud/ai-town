import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_IMA_ARCHIVE_DIR,
  exportLighthouseArchive,
} from './export-lighthouse-ima';

const INTERVAL_MS = 10 * 60 * 1_000;
let stopping = false;
let wake: (() => void) | undefined;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });
}

async function writeHeartbeat(root: string, payload: Record<string, unknown>) {
  await mkdir(root, { recursive: true });
  const target = join(root, '.archive-heartbeat.json');
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600,
  });
  await rename(temporary, target);
}

async function main() {
  while (!stopping) {
    const startedAt = Date.now();
    const root = process.env.LIGHTHOUSE_IMA_ARCHIVE_DIR ?? DEFAULT_IMA_ARCHIVE_DIR;
    let succeeded = false;
    try {
      const result = await exportLighthouseArchive({ now: startedAt, root });
      await writeHeartbeat(root, {
        ok: true,
        pid: process.pid,
        exportedAt: Date.now(),
        worldId: result.worldId,
        days: result.days,
      });
      succeeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[archive] ${new Date().toISOString()} ${message}\n`);
      try {
        await writeHeartbeat(root, {
          ok: false,
          pid: process.pid,
          failedAt: Date.now(),
          error: message,
        });
      } catch {
        // The stderr line remains the durable service-level signal.
      }
    }
    const retryInterval = succeeded ? INTERVAL_MS : 15_000;
    const remaining = Math.max(1_000, retryInterval - (Date.now() - startedAt));
    await new Promise<void>((resolvePromise) => {
      const timer = setTimeout(done, remaining);
      wake = done;
      function done() {
        clearTimeout(timer);
        wake = undefined;
        resolvePromise();
      }
    });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
