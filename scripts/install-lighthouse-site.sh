#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOGS="${LIGHTHOUSE_TOWN_LOG_DIR:-$HOME/Library/Logs/LighthouseTown}"
STATE_DIR="${LIGHTHOUSE_TOWN_STATE_DIR:-$HOME/Library/Application Support/LighthouseTown}"
FRONTEND_PORT="${LIGHTHOUSE_TOWN_PORT:-4174}"
BACKEND_PORT=3210

NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
NPX_BIN="$(command -v npx)"
CURL_BIN="$(command -v curl)"
NC_BIN="$(command -v nc)"

CONVEX_ENTRY="$ROOT/node_modules/convex/bin/main.js"
VITE_ENTRY="$ROOT/node_modules/vite/bin/vite.js"
BACKEND_PID_FILE="$STATE_DIR/backend.pid"
FRONTEND_PID_FILE="$STATE_DIR/frontend.pid"

mkdir -p "$LOGS" "$STATE_DIR"

# Build this checkout before replacing the running preview. A failed build leaves
# the existing dedicated site alone instead of serving a partially updated dist.
(
  cd "$ROOT"
  "$NPM_BIN" run build
)

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

# Remove only earlier Lighthouse Town launchd/screen wrappers. Never scan for or
# kill arbitrary Node/Vite/Convex commands belonging to another project.
if command -v launchctl >/dev/null 2>&1; then
  for label in com.lighthousetown.frontend com.lighthousetown.backend; do
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/$label.plist"
  done
fi
if command -v screen >/dev/null 2>&1; then
  screen -S lighthousetown-frontend -X quit 2>/dev/null || true
  screen -S lighthousetown-backend -X quit 2>/dev/null || true
fi

stop_managed_process "$FRONTEND_PID_FILE" "/node_modules/vite/bin/vite.js"
stop_managed_process "$BACKEND_PID_FILE" "/node_modules/convex/bin/main.js"
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
    exit 0
  fi
  sleep 1
done

stop_managed_process "$FRONTEND_PID_FILE" "/node_modules/vite/bin/vite.js"
stop_managed_process "$BACKEND_PID_FILE" "/node_modules/convex/bin/main.js"
echo "Lighthouse Town site failed its startup health check" >&2
exit 1
