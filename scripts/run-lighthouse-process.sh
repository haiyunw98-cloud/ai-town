#!/bin/zsh
set -euo pipefail

ROOT="$1"
STDOUT_PATH="$2"
STDERR_PATH="$3"
PID_PATH="$4"
shift 4

cd "$ROOT"
print -r -- "$$" > "$PID_PATH"
exec "$@" >> "$STDOUT_PATH" 2>> "$STDERR_PATH"
