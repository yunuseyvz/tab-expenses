#!/bin/sh
# Dev helper: pick a free port, run the built server, wait for it to answer.
#
# Deliberately avoids `pkill -f <pattern>`: the pattern text appears in the
# killer's own command line, so pkill matches and kills the shell running it.
# This resolves the PID by listening port instead.
set -e

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
LOG_DIR=${LOG_DIR:-/tmp/opencode/swl}
mkdir -p "$LOG_DIR"

# --- free port -----------------------------------------------------------
PORT=$(node -e '
const net = require("net");
const s = net.createServer();
s.once("error", () => process.exit(1));
s.listen(0, "127.0.0.1", () => {
  const p = s.address().port;
  s.close(() => process.stdout.write(String(p)));
});
')
echo "PORT=$PORT"
echo "$PORT" > "$LOG_DIR/port"

# --- load env ------------------------------------------------------------
set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a
# The app must agree with the port we actually bound.
BETTER_AUTH_URL="http://127.0.0.1:$PORT"
export BETTER_AUTH_URL

# --- run -----------------------------------------------------------------
# Start's default build shape: a client/ dir plus a fetch-style server entry,
# served by srvx. See
# https://tanstack.com/start/latest/docs/framework/react/guide/hosting
# The static dir is resolved relative to the server entry, not the cwd.
cd "$ROOT"
npx --yes srvx --prod --port "$PORT" -s ../client ./dist/server/server.js \
  > "$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$LOG_DIR/pid"

# --- wait for readiness --------------------------------------------------
i=0
while [ $i -lt 40 ]; do
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/ping" 2>/dev/null; then
    echo "ready pid=$SERVER_PID port=$PORT"
    exit 0
  fi
  i=$((i + 1))
  sleep 0.5
done

echo "server did not become ready; log follows:" >&2
cat "$LOG_DIR/server.log" >&2
exit 1
