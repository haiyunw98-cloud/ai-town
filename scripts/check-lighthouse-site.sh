#!/bin/zsh
set -euo pipefail

FRONTEND_PORT="${LIGHTHOUSE_TOWN_PORT:-4174}"
STATE_DIR="${LIGHTHOUSE_TOWN_STATE_DIR:-$HOME/Library/Application Support/LighthouseTown}"
ARCHIVE_ROOT="${LIGHTHOUSE_IMA_ARCHIVE_DIR:-$HOME/Documents/灯塔镇研究档案/IMA导入}"
ARCHIVE_PID_FILE="$STATE_DIR/archive.pid"
ARCHIVE_ENTRY="$(cd "$(dirname "${(%):-%N}")/.." && pwd)/scripts/run-lighthouse-archive.ts"
frontend="$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$FRONTEND_PORT/ai-town/")"
if nc -z 127.0.0.1 3210; then
  backend="tcp-open"
else
  backend="closed"
fi

archive="stopped"
if [[ -f "$ARCHIVE_PID_FILE" ]]; then
  archive_pid="$(<"$ARCHIVE_PID_FILE")"
  archive_command="$(ps -p "$archive_pid" -o command= 2>/dev/null || true)"
  if [[ "$archive_pid" == <-> ]] \
    && kill -0 "$archive_pid" 2>/dev/null \
    && [[ "$archive_command" == *"$ARCHIVE_ENTRY"* ]] \
    && [[ -f "$ARCHIVE_ROOT/.archive-heartbeat.json" ]] \
    && grep -q '"ok": true' "$ARCHIVE_ROOT/.archive-heartbeat.json"; then
    archive="healthy"
  fi
fi

echo "url=http://localhost:$FRONTEND_PORT/ai-town frontend=$frontend backend=$backend archive=$archive archive_dir=$ARCHIVE_ROOT"
test "$frontend" = "200"
test "$backend" = "tcp-open"
test "$archive" = "healthy"
