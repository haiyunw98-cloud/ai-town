#!/bin/zsh
set -euo pipefail

frontend="$(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ai-town/)"
if nc -z 127.0.0.1 3210; then
  backend="tcp-open"
else
  backend="closed"
fi

echo "frontend=$frontend backend=$backend"
test "$frontend" = "200"
test "$backend" = "tcp-open"
