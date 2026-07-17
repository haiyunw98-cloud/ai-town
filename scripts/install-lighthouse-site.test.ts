import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('Lighthouse Town site installer', () => {
  const installer = fileURLToPath(new URL('./install-lighthouse-site.sh', import.meta.url));
  const source = readFileSync(installer, 'utf8');
  const checkoutRoot = resolve(dirname(installer), '..');

  test('derives the checkout root and discovers required executables', () => {
    expect(source).toContain('dirname "$SCRIPT_PATH"');
    expect(source).toContain('ROOT=');
    expect(source).not.toContain('/Users/why');
    expect(source).toContain('command -v node');
    expect(source).toContain('command -v npm');
    expect(source).not.toContain('command -v npx');
  });

  test('backs up dist and arms restoration before building the current checkout', () => {
    const backup = source.indexOf('backup_dist');
    const trap = source.indexOf("trap 'restore_dist_on_exit $?' EXIT");
    const build = source.indexOf('"$NPM_BIN" run build');
    const discard = source.indexOf('rm -rf "$DIST_BACKUP"', build);
    const stop = source.indexOf('stop_managed_process', discard);
    const preview = source.indexOf('nohup "$NODE_BIN" "$VITE_ENTRY" preview');
    expect(backup).toBeGreaterThan(-1);
    expect(trap).toBeGreaterThan(backup);
    expect(build).toBeGreaterThan(trap);
    expect(discard).toBeGreaterThan(build);
    expect(stop).toBeGreaterThan(discard);
    expect(build).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(build);
    expect(source).toContain('cp -R "$DIST_DIR" "$DIST_BACKUP"');
    expect(source).toContain('restore_dist');
    expect(source).toContain('mv "$DIST_RESTORE" "$DIST_DIR"');
  });

  test('uses dedicated ports without killing unrelated processes', () => {
    expect(source).toContain('FRONTEND_PORT="${LIGHTHOUSE_TOWN_PORT:-4174}"');
    expect(source).toContain('BACKEND_PORT=3210');
    expect(source).not.toContain('5173');
    expect(source).not.toContain('pkill');
    expect(source).not.toContain('screen -S');
    expect(source).not.toContain('launchctl bootout');
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
    expect(source).toContain('stop_managed_process "$FRONTEND_PID_FILE" "$VITE_ENTRY"');
    expect(source).toContain('stop_managed_process "$BACKEND_PID_FILE" "$CONVEX_ENTRY"');
    expect(source).not.toContain('"/node_modules/vite/bin/vite.js"');
    expect(source).not.toContain('"/node_modules/convex/bin/main.js"');
  });

  test.each([
    ['Vite', 'node_modules/vite/bin/vite.js'],
    ['Convex', 'node_modules/convex/bin/main.js'],
  ])('refuses to kill another checkout\'s %s process', (_label, relativeEntry) => {
    const temporary = mkdtempSync(resolve(tmpdir(), 'lighthouse-installer-'));
    const pidFile = resolve(temporary, 'service.pid');
    const killLog = resolve(temporary, 'kill.log');
    const expectedEntry = resolve(checkoutRoot, relativeEntry);
    const otherEntry = resolve(temporary, 'other-checkout', relativeEntry);
    writeFileSync(pidFile, '4242\n');

    try {
      const result = spawnSync('zsh', ['-c', [
        'source "$INSTALLER"',
        'kill() { if [[ "$1" == "-0" ]]; then return 0; fi; print -r -- "$*" >> "$KILL_LOG"; }',
        'ps() { print -r -- "node $OTHER_ENTRY"; }',
        'sleep() { :; }',
        'stop_managed_process "$PID_FILE" "$EXPECTED_ENTRY"',
      ].join('\n')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          LIGHTHOUSE_TOWN_SOURCE_ONLY: '1',
          INSTALLER: installer,
          PID_FILE: pidFile,
          KILL_LOG: killLog,
          EXPECTED_ENTRY: expectedEntry,
          OTHER_ENTRY: otherEntry,
        },
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain('Refusing to stop unmanaged PID 4242');
      expect(() => readFileSync(killLog, 'utf8')).toThrow();
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  test('restores a previous dist from its state-directory backup', () => {
    const temporary = mkdtempSync(resolve(tmpdir(), 'lighthouse-dist-'));
    try {
      const result = spawnSync('zsh', ['-c', [
        'source "$INSTALLER"',
        'ROOT="$TEMP_ROOT"',
        'STATE_DIR="$TEMP_ROOT/state"',
        'DIST_DIR="$ROOT/dist"',
        'DIST_BACKUP="$STATE_DIR/dist-backup.test"',
        'DIST_RESTORE="$ROOT/.dist-restore.test"',
        'DIST_FAILED="$ROOT/.dist-failed.test"',
        'mkdir -p "$DIST_DIR" "$STATE_DIR"',
        'print -r -- old-live-bundle > "$DIST_DIR/index.html"',
        'backup_dist',
        'print -r -- broken-build > "$DIST_DIR/index.html"',
        'restore_dist',
        'grep -q old-live-bundle "$DIST_DIR/index.html"',
        '[[ ! -e "$DIST_BACKUP" ]]',
      ].join('\n')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          LIGHTHOUSE_TOWN_SOURCE_ONLY: '1',
          INSTALLER: installer,
          TEMP_ROOT: temporary,
        },
      });
      expect(result.status).toBe(0);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
