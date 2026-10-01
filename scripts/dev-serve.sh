#!/bin/sh
# Dev helper: pick a free port, run the built server, wait for it to answer.
#
# Deliberately avoids `pkill -f <pattern>`: the pattern text appears in the
# killer's own command line, so pkill matches and kills the shell running it.
# This resolves the PID by recorded PID file instead.
#
# With nitro/vite the build emits a self-contained .output/, so the server runs
# as plain `node .output/server/index.mjs`. Without it, Start's default shape is
# dist/ plus a fetch-style server entry served by srvx — handled automatically
# so this script keeps working either way.
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
# An explicitly exported variable always wins over the .env file, which is what
# lets scripts/e2e.sh point the server at its own throwaway database: sourcing
# .env here used to silently put the compose stack's URL back and the server
# then failed with ECONNREFUSED mid-suite.
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

# The app must agree with the port we actually bound.
BETTER_AUTH_URL="http://127.0.0.1:$PORT"
export BETTER_AUTH_URL

# --- run -----------------------------------------------------------------
cd "$ROOT"
if [ -f .output/server/index.mjs ]; then
  PORT="$PORT" HOST=127.0.0.1 node .output/server/index.mjs \
    > "$LOG_DIR/server.log" 2>&1 &
else
  npx --yes srvx --prod --port "$PORT" -s ../client ./dist/server/server.js \
    > "$LOG_DIR/server.log" 2>&1 &
fi
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
