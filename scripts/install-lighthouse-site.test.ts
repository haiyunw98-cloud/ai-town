import { readFileSync } from 'node:fs';

describe('Lighthouse Town site installer', () => {
  const source = readFileSync(new URL('./install-lighthouse-site.sh', import.meta.url), 'utf8');

  test('cleans legacy supervisors and starts exactly one direct process per service', () => {
    expect(source).toContain('pkill -f');
    expect(source).not.toMatch(/screen -dmS[\s\S]*while true/);
    expect(source).toContain('exec /Users/why/.local/bin/node node_modules/convex/bin/main.js');
    expect(source).toContain('exec /Users/why/.local/bin/node node_modules/vite/bin/vite.js');
  });
});
