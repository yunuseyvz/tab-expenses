#!/bin/sh
# Stop the dev server started by dev-serve.sh, by recorded PID.
set -e
LOG_DIR=${LOG_DIR:-/tmp/opencode/swl}
PIDFILE="$LOG_DIR/pid"
[ -f "$PIDFILE" ] || { echo "no pidfile; nothing to stop"; exit 0; }
PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "stopped $PID"
else
  echo "pid $PID not running"
fi
rm -f "$PIDFILE"
