import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('Lighthouse Town process supervisor', () => {
  const runner = fileURLToPath(new URL('./run-lighthouse-process.sh', import.meta.url));
  const source = readFileSync(runner, 'utf8');

  test('restarts a failed child instead of ending the persistent service session', () => {
    expect(source).toContain('while (( ! stopping )); do');
    expect(source).toContain('LIGHTHOUSE_PROCESS_RESTART_DELAY_SECS:-3');
    expect(source).toContain('Restarting after');
  });
});
