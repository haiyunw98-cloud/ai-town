import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

type LocalBackendConfig = {
  ports: { cloud: number; site: number };
  backendVersion: string;
  instanceSecret: string;
  deploymentName: string;
};

function loadConfig(path: string): LocalBackendConfig {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LocalBackendConfig>;
  if (!parsed.backendVersion?.match(/^precompiled-[A-Za-z0-9._-]+$/u)) {
    throw new Error('Invalid local Convex backend version.');
  }
  if (!parsed.instanceSecret || !parsed.deploymentName) {
    throw new Error('Incomplete local Convex instance configuration.');
  }
  if (!Number.isInteger(parsed.ports?.cloud) || !Number.isInteger(parsed.ports?.site)) {
    throw new Error('Invalid local Convex ports.');
  }
  return parsed as LocalBackendConfig;
}

const projectRoot = resolve(process.argv[2] ?? process.cwd());
const dataRoot = resolve(projectRoot, '.convex/local/default');
const config = loadConfig(resolve(dataRoot, 'config.json'));
const binary = resolve(
  homedir(),
  '.cache',
  'convex',
  'binaries',
  config.backendVersion,
  'convex-local-backend',
);
if (!existsSync(binary)) throw new Error(`Local Convex backend binary is missing: ${binary}`);

const child = spawn(binary, [
  '--port', String(config.ports.cloud),
  '--site-proxy-port', String(config.ports.site),
  '--convex-origin', `http://127.0.0.1:${config.ports.cloud}`,
  '--convex-site', `http://127.0.0.1:${config.ports.site}`,
  '--instance-name', config.deploymentName,
  '--instance-secret', config.instanceSecret,
  '--local-storage', resolve(dataRoot, 'convex_local_storage'),
  '--disable-beacon',
  resolve(dataRoot, 'convex_local_backend.sqlite3'),
], { stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
