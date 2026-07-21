#!/bin/zsh
set -euo pipefail

ROOT="$1"
STDOUT_PATH="$2"
STDERR_PATH="$3"
PID_PATH="$4"
shift 4

RESTART_DELAY_SECS="${LIGHTHOUSE_PROCESS_RESTART_DELAY_SECS:-3}"
if [[ ! "$RESTART_DELAY_SECS" == <-> ]] || (( RESTART_DELAY_SECS < 1 )); then
  print -r -- "LIGHTHOUSE_PROCESS_RESTART_DELAY_SECS must be a positive integer" >&2
  exit 2
fi

cd "$ROOT"
print -r -- "$$" > "$PID_PATH"

stopping=0
child_pid=""
stop_child() {
  stopping=1
  if [[ "$child_pid" == <-> ]] && kill -0 "$child_pid" 2>/dev/null; then
    kill "$child_pid" 2>/dev/null || true
  fi
}
trap stop_child INT TERM

while (( ! stopping )); do
  "$@" >> "$STDOUT_PATH" 2>> "$STDERR_PATH" &
  child_pid=$!
  if wait "$child_pid"; then
    child_status=0
  else
    child_status=$?
  fi
  child_pid=""
  (( stopping )) && break
  print -r -- "[supervisor] Child exited with status $child_status. Restarting after ${RESTART_DELAY_SECS}s." \
    >> "$STDERR_PATH"
  sleep "$RESTART_DELAY_SECS"
done
