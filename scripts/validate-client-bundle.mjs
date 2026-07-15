import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const assetsDirectory = resolve('dist/assets');
const clientBundles = readdirSync(assetsDirectory).filter(
  (filename) => filename.startsWith('index-') && filename.endsWith('.js'),
);

if (clientBundles.length === 0) {
  throw new Error(`No Vite client bundle found in ${assetsDirectory}`);
}

const serverRegistrationWarning = 'Convex functions should not be imported in the browser';
const contaminatedBundles = clientBundles.filter((filename) =>
  readFileSync(resolve(assetsDirectory, filename), 'utf8').includes(serverRegistrationWarning),
);

if (contaminatedBundles.length > 0) {
  throw new Error(
    `Convex server registrations leaked into the browser bundle: ${contaminatedBundles.join(', ')}`,
  );
}

console.log('Client bundle boundary validated.');
