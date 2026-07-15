#!/bin/zsh
set -euo pipefail

ROOT="/Users/why/Documents/aitown"
LOGS="$HOME/Library/Logs/LighthouseTown"

mkdir -p "$LOGS"

# Clean up the launchd variant. macOS denies background LaunchAgents access to
# projects under Documents unless the user grants Full Disk Access.
for label in com.lighthousetown.frontend com.lighthousetown.backend; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done

screen -S lighthousetown-frontend -X quit 2>/dev/null || true
screen -S lighthousetown-backend -X quit 2>/dev/null || true

# Older installer versions wrapped both services in orphanable endless-loop
# supervisors. Remove only commands rooted in this project before starting the
# single managed pair below.
pkill -f "cd '$ROOT'; while true; do /Users/why/.local/bin/node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173" 2>/dev/null || true
pkill -f "cd '$ROOT'; while true; do /Users/why/.local/bin/node node_modules/convex/bin/main.js dev --tail-logs" 2>/dev/null || true
pkill -f "/Users/why/.local/bin/node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173 --strictPort" 2>/dev/null || true
pkill -f "/Users/why/.local/bin/node node_modules/convex/bin/main.js dev --tail-logs" 2>/dev/null || true
sleep 1

screen -dmS lighthousetown-backend /bin/zsh -lc \
  "cd '$ROOT'; exec /Users/why/.local/bin/node node_modules/convex/bin/main.js dev --tail-logs >> '$LOGS/backend.log' 2>> '$LOGS/backend-error.log'"

screen -dmS lighthousetown-frontend /bin/zsh -lc \
  "cd '$ROOT'; exec /Users/why/.local/bin/node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173 --strictPort >> '$LOGS/frontend.log' 2>> '$LOGS/frontend-error.log'"

for _ in {1..20}; do
  if curl -fsS http://127.0.0.1:5173/ai-town/ >/dev/null && nc -z 127.0.0.1 3210; then
    echo "Lighthouse Town site installed: http://localhost:5173/ai-town"
    exit 0
  fi
  sleep 1
done

echo "Lighthouse Town site failed its startup health check" >&2
exit 1
