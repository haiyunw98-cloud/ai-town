#!/bin/zsh
set -euo pipefail

FRONTEND_PORT="${LIGHTHOUSE_TOWN_PORT:-4174}"
frontend="$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$FRONTEND_PORT/ai-town/")"
if nc -z 127.0.0.1 3210; then
  backend="tcp-open"
else
  backend="closed"
fi

echo "url=http://localhost:$FRONTEND_PORT/ai-town frontend=$frontend backend=$backend"
test "$frontend" = "200"
test "$backend" = "tcp-open"
