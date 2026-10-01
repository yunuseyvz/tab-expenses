#!/bin/sh
# Container entrypoint: wait for the database, migrate, then serve.
#
# Migrations run on boot. That is safe for the single-instance deployment this
# is written for. If you ever run more than one replica, move this to a
# separate one-shot job — concurrent `drizzle-kit migrate` runs can race on the
# migrations table.
set -e

PORT="${PORT:-3000}"
DB_WAIT_TIMEOUT="${DB_WAIT_TIMEOUT:-60}"

log() { echo "[entrypoint] $*"; }

# ── wait for postgres ────────────────────────────────────────────────────
# Parsed out of DATABASE_URL rather than assumed, so pointing the app at a
# managed database needs no extra configuration.
DB_HOST=$(printf '%s' "$DATABASE_URL" | sed -n 's#.*@\([^:/?]*\).*#\1#p')
DB_PORT=$(printf '%s' "$DATABASE_URL" | sed -n 's#.*@[^:/?]*:\([0-9]*\).*#\1#p')
DB_PORT="${DB_PORT:-5432}"

if [ -n "$DB_HOST" ]; then
  log "waiting for postgres at $DB_HOST:$DB_PORT (timeout ${DB_WAIT_TIMEOUT}s)"
  i=0
  until node -e "
    const net = require('net')
    const s = net.connect({ host: process.argv[1], port: Number(process.argv[2]) })
    s.on('connect', () => { s.end(); process.exit(0) })
    s.on('error', () => process.exit(1))
    setTimeout(() => process.exit(1), 2000)
  " "$DB_HOST" "$DB_PORT" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -ge "$DB_WAIT_TIMEOUT" ]; then
      log "ERROR: postgres not reachable after ${DB_WAIT_TIMEOUT}s"
      exit 1
    fi
    sleep 1
  done
  log "postgres reachable"
fi

# ── validate configuration before migrating ──────────────────────────────
# Failing here beats failing on the first request with a stack trace.
log "validating configuration"
node -e "
  const required = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL']
  const missing = required.filter((k) => !process.env[k])
  if (missing.length) {
    console.error('[entrypoint] missing required env vars: ' + missing.join(', '))
    process.exit(1)
  }
  if (process.env.BETTER_AUTH_SECRET.length < 32 && process.env.NODE_ENV === 'production') {
    console.error('[entrypoint] BETTER_AUTH_SECRET should be at least 32 characters in production')
    process.exit(1)
  }
"

# ── migrate ──────────────────────────────────────────────────────────────
log "applying migrations"
./node_modules/.bin/drizzle-kit migrate

# ── serve ────────────────────────────────────────────────────────────────
log "starting server on :$PORT"
exec "$@"
