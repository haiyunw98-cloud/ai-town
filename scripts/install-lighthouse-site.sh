#!/bin/zsh
set -euo pipefail

SCRIPT_PATH="${(%):-%N}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOGS="${LIGHTHOUSE_TOWN_LOG_DIR:-$HOME/Library/Logs/LighthouseTown}"
STATE_DIR="${LIGHTHOUSE_TOWN_STATE_DIR:-$HOME/Library/Application Support/LighthouseTown}"
FRONTEND_PORT="${LIGHTHOUSE_TOWN_PORT:-4174}"
BACKEND_PORT=3210

NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
CURL_BIN="$(command -v curl)"
NC_BIN="$(command -v nc)"

CONVEX_ENTRY="$ROOT/node_modules/convex/bin/main.js"
VITE_ENTRY="$ROOT/node_modules/vite/bin/vite.js"
BACKEND_PID_FILE="$STATE_DIR/backend.pid"
FRONTEND_PID_FILE="$STATE_DIR/frontend.pid"
DIST_DIR="$ROOT/dist"
DIST_BACKUP="$STATE_DIR/dist-backup.$$"
DIST_RESTORE="$ROOT/.dist-restore.$$"
DIST_FAILED="$ROOT/.dist-failed.$$"
HAD_DIST=0

backup_dist() {
  rm -rf "$DIST_BACKUP"
  if [[ ! -d "$DIST_DIR" ]]; then
    HAD_DIST=0
    return 0
  fi
  if ! cp -R "$DIST_DIR" "$DIST_BACKUP"; then
    rm -rf "$DIST_BACKUP"
    return 1
  fi
  HAD_DIST=1
}

restore_dist() {
  rm -rf "$DIST_RESTORE" "$DIST_FAILED"
  if (( ! HAD_DIST )); then
    rm -rf "$DIST_DIR" "$DIST_BACKUP"
    return 0
  fi

  # Prepare the known-good directory beside dist, then rename it into place.
  # The previous failed build is retained until that rename succeeds.
  if ! cp -R "$DIST_BACKUP" "$DIST_RESTORE"; then
    echo "Unable to prepare the previous Lighthouse Town dist for restoration" >&2
    return 1
  fi
  if [[ -e "$DIST_DIR" ]] && ! mv "$DIST_DIR" "$DIST_FAILED"; then
    echo "Unable to move the failed Lighthouse Town dist aside" >&2
    rm -rf "$DIST_RESTORE"
    return 1
  fi
  if ! mv "$DIST_RESTORE" "$DIST_DIR"; then
    echo "Unable to restore the previous Lighthouse Town dist" >&2
    [[ -e "$DIST_FAILED" ]] && mv "$DIST_FAILED" "$DIST_DIR" 2>/dev/null || true
    return 1
  fi
  rm -rf "$DIST_FAILED" "$DIST_BACKUP"
}

restore_dist_on_exit() {
  local status="$1"
  trap - EXIT INT TERM
  if ! restore_dist; then
    echo "Lighthouse Town build failed and the previous dist could not be fully restored" >&2
  fi
  exit "$status"
}

stop_managed_process() {
  local pid_file="$1"
  local expected_entry="$2"
  [[ -f "$pid_file" ]] || return 0

  local pid
  pid="$(<"$pid_file")"
  if [[ "$pid" == <-> ]] && kill -0 "$pid" 2>/dev/null; then
    local command_line
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command_line" == *"$expected_entry"* ]]; then
      kill "$pid"
      for _ in {1..20}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
    else
      echo "Refusing to stop unmanaged PID $pid from $pid_file" >&2
    fi
  fi
  rm -f "$pid_file"
}

main() {
  mkdir -p "$LOGS" "$STATE_DIR"

  # Keep a known-good copy while npm runs tsc, Vite, and the client-bundle
  # boundary validator. A failure exits through the restore trap before any
  # running process is inspected or stopped.
  backup_dist
  trap 'restore_dist_on_exit $?' EXIT
  trap 'exit 130' INT TERM
  (
    cd "$ROOT"
    "$NPM_BIN" run build
  )
  trap - EXIT INT TERM
  rm -rf "$DIST_BACKUP"

  # PID files are advisory: the exact absolute entry path must still match this
  # checkout before the process may be stopped.
  stop_managed_process "$FRONTEND_PID_FILE" "$VITE_ENTRY"
  stop_managed_process "$BACKEND_PID_FILE" "$CONVEX_ENTRY"
  sleep 1

  if "$NC_BIN" -z 127.0.0.1 "$FRONTEND_PORT" 2>/dev/null; then
    echo "Port $FRONTEND_PORT is occupied by an unmanaged service; refusing to stop it" >&2
    exit 1
  fi
  if "$NC_BIN" -z 127.0.0.1 "$BACKEND_PORT" 2>/dev/null; then
    echo "Port $BACKEND_PORT is occupied by an unmanaged service; refusing to stop it" >&2
    exit 1
  fi

  (
    cd "$ROOT"
    nohup "$NODE_BIN" "$CONVEX_ENTRY" dev --tail-logs \
      >> "$LOGS/backend.log" 2>> "$LOGS/backend-error.log" &
    echo $! > "$BACKEND_PID_FILE"
  )

  (
    cd "$ROOT"
    nohup "$NODE_BIN" "$VITE_ENTRY" preview --host 127.0.0.1 \
      --port "$FRONTEND_PORT" --strictPort \
      >> "$LOGS/frontend.log" 2>> "$LOGS/frontend-error.log" &
    echo $! > "$FRONTEND_PID_FILE"
  )

  for _ in {1..20}; do
    backend_pid="$(<"$BACKEND_PID_FILE")"
    frontend_pid="$(<"$FRONTEND_PID_FILE")"
    if kill -0 "$backend_pid" 2>/dev/null \
      && kill -0 "$frontend_pid" 2>/dev/null \
      && "$CURL_BIN" -fsS "http://127.0.0.1:$FRONTEND_PORT/ai-town/" >/dev/null \
      && "$NC_BIN" -z 127.0.0.1 "$BACKEND_PORT"; then
      echo "Lighthouse Town site installed: http://localhost:$FRONTEND_PORT/ai-town"
      return 0
    fi
    sleep 1
  done

  stop_managed_process "$FRONTEND_PID_FILE" "$VITE_ENTRY"
  stop_managed_process "$BACKEND_PID_FILE" "$CONVEX_ENTRY"
  echo "Lighthouse Town site failed its startup health check" >&2
  return 1
}

if [[ "${LIGHTHOUSE_TOWN_SOURCE_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
