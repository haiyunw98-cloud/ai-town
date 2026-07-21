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
    expect(source).toContain('command -v screen');
    expect(source).toContain('command -v pgrep');
    expect(source).not.toContain('command -v npx');
  });

  test('backs up dist and arms restoration before building the current checkout', () => {
    const backup = source.indexOf('backup_dist');
    const trap = source.indexOf("trap 'restore_dist_on_exit $?' EXIT");
    const build = source.indexOf('"$NPM_BIN" run build');
    const discard = source.indexOf('rm -rf "$DIST_BACKUP"', build);
    const stop = source.indexOf('stop_managed_session', discard);
    const preview = source.indexOf('"$SCREEN_BIN" -DmS "$FRONTEND_SESSION"', stop);
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
    expect(source).toContain('"$SCREEN_BIN" -S "$session" -X quit');
    expect(source).toContain('"$SCREEN_BIN" -DmS "$BACKEND_SESSION"');
    expect(source).toContain('"$SCREEN_BIN" -DmS "$FRONTEND_SESSION"');
    expect(source).toContain('"$SCREEN_BIN" -DmS "$ARCHIVE_SESSION"');
    expect(source).toContain('LIGHTHOUSE_TOWN_STARTUP_TIMEOUT_SECS:-300');
    expect(source).toContain('CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS');
    expect(source).toContain('for ((attempt = 1; attempt <= STARTUP_TIMEOUT_SECS; attempt += 1)); do');
    expect(source).toContain('listing="$("$SCREEN_BIN" -ls 2>/dev/null || true)"');
  });

  test('manages only dedicated detached sessions and keeps separate logs', () => {
    expect(source).toContain('lighthouse-town-frontend');
    expect(source).toContain('lighthouse-town-backend');
    expect(source).toContain('lighthouse-town-archive');
    expect(source).toContain('frontend.log');
    expect(source).toContain('frontend-error.log');
    expect(source).toContain('backend.log');
    expect(source).toContain('backend-error.log');
    expect(source).toContain('archive.log');
    expect(source).toContain('archive-error.log');
    expect(source).toContain('frontend.pid');
    expect(source).toContain('backend.pid');
    expect(source).toContain('archive.pid');
    expect(source).toContain('ps -p "$pid" -o command=');
    expect(source).toContain('"$PGREP_BIN" -P "$pid"');
    expect(source).toContain('Refusing to stop unmanaged PID');
    expect(source).toContain('scripts/run-convex-local-backend.ts');
    expect(source).not.toContain('dev --tail-logs');
    expect(source).toContain('node_modules/vite/bin/vite.js');
    expect(source).toContain('stop_managed_session "$FRONTEND_SESSION"');
    expect(source).toContain('stop_managed_session "$BACKEND_SESSION"');
    expect(source).toContain('stop_managed_session "$ARCHIVE_SESSION"');
    expect(source).toContain('scripts/run-lighthouse-archive.ts');
    expect(source).toContain('"ok": true');
    expect(source).not.toContain('"/node_modules/vite/bin/vite.js"');
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
