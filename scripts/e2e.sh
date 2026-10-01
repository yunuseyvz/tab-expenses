#!/bin/sh
# Run the E2E suite against a freshly built server.
#
# Boots Postgres and Mailpit if they are not already up, migrates, seeds, starts
# the built server on a free port, runs Playwright, then tears the server down.
set -e

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

# shellcheck disable=SC1091
set -a
. "$ROOT/.env"
set +a

# ── services ─────────────────────────────────────────────────────────────
ensure_db() {
  if docker exec swl-db pg_isready -U app >/dev/null 2>&1; then
    echo "postgres: up"
  else
    echo "postgres: starting"
    docker rm -f swl-db >/dev/null 2>&1 || true
    docker run -d --name swl-db \
      -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=app \
      -p 55432:5432 postgres:17-alpine >/dev/null
    i=0
    while [ $i -lt 60 ]; do
      docker exec swl-db pg_isready -U app >/dev/null 2>&1 && break
      i=$((i + 1)); sleep 1
    done
  fi
}

ensure_mail() {
  if curl -sf -o /dev/null "http://127.0.0.1:8025/api/v1/messages?limit=1" 2>/dev/null; then
    echo "mailpit: up"
  else
    echo "mailpit: starting"
    docker rm -f swl-mail >/dev/null 2>&1 || true
    docker run -d --name swl-mail -p 1025:1025 -p 8025:8025 \
      axllent/mailpit:latest >/dev/null
    sleep 2
  fi
}

ensure_db
ensure_mail

# ── schema + data ────────────────────────────────────────────────────────
echo "migrating"
pnpm db:migrate >/dev/null
echo "seeding"
pnpm db:seed | tail -3

# ── build + serve ────────────────────────────────────────────────────────
echo "building"
pnpm build >/dev/null 2>&1

sh scripts/dev-serve.sh
SWL_PORT=$(cat /tmp/opencode/swl/port)
export SWL_PORT
export SWL_BASE_URL="http://127.0.0.1:$SWL_PORT"
echo "server on $SWL_BASE_URL"

# ── run ──────────────────────────────────────────────────────────────────
set +e
pnpm exec playwright test "$@"
STATUS=$?
set -e

sh scripts/dev-stop.sh || true
echo "e2e exit: $STATUS"
exit $STATUS
