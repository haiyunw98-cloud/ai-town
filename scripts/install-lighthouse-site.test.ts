import { readFileSync } from 'node:fs';

describe('Lighthouse Town site installer', () => {
  const source = readFileSync(new URL('./install-lighthouse-site.sh', import.meta.url), 'utf8');

  test('derives the checkout root and discovers required executables', () => {
    expect(source).toContain('dirname "$0"');
    expect(source).toContain('ROOT=');
    expect(source).not.toContain('/Users/why');
    expect(source).toContain('command -v node');
    expect(source).toContain('command -v npm');
    expect(source).toContain('command -v npx');
  });

  test('builds the current checkout before starting its preview', () => {
    const build = source.indexOf('"$NPM_BIN" run build');
    const preview = source.indexOf('nohup "$NODE_BIN" "$VITE_ENTRY" preview');
    expect(build).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(build);
  });

  test('uses dedicated ports without killing unrelated processes', () => {
    expect(source).toContain('FRONTEND_PORT="${LIGHTHOUSE_TOWN_PORT:-4174}"');
    expect(source).toContain('BACKEND_PORT=3210');
    expect(source).not.toContain('5173');
    expect(source).not.toContain('pkill');
  });

  test('manages only verified pid-file processes and keeps separate logs', () => {
    expect(source).toContain('frontend.pid');
    expect(source).toContain('backend.pid');
    expect(source).toContain('kill -0');
    expect(source).toContain('ps -p');
    expect(source).toContain('frontend.log');
    expect(source).toContain('frontend-error.log');
    expect(source).toContain('backend.log');
    expect(source).toContain('backend-error.log');
    expect(source).toContain('node_modules/convex/bin/main.js');
    expect(source).toContain('node_modules/vite/bin/vite.js');
    expect(source).toContain(
      'stop_managed_process "$FRONTEND_PID_FILE" "/node_modules/vite/bin/vite.js"',
    );
    expect(source).toContain(
      'stop_managed_process "$BACKEND_PID_FILE" "/node_modules/convex/bin/main.js"',
    );
  });
});
