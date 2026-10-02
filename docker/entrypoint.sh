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
#
# The exit code is logged, and `set -x` is on for this step only.
#
# Without them this step failed silently on a deploy and the cause was a
# three-hour guessing game: the container died partway through, `restart:
# unless-stopped` started it again, it died at the same place, and the only
# evidence was a progress spinner cut off mid-draw. The spinner writes its own
# ANSI erase codes to stderr, so the log showed `[applying migrations...KG` — which
# reads like the tail of "Killed" and is not. It is `2K` and `1G` from the spinner
# redrawing itself.
#
# So: show the commands, report the code, and print the kernel's own verdict if
# the process was killed from outside. A killed process returns 137, and 137 is
# the only number that distinguishes "ran out of memory on the host" from "drizzle
# failed", and those need completely different fixes.
# `cmd || RC=$?` rather than `cmd; RC=$?`: this script runs under `set -e`, so a
# bare failing command exits the container on the spot and the exit code is never
# read. Handling it in the `||` arm is what keeps the reporting below reachable.
log "applying migrations"
MIGRATE_RC=0
set -x
./node_modules/.bin/drizzle-kit migrate || MIGRATE_RC=$?
set +x

if [ "$MIGRATE_RC" -ne 0 ]; then
  log "ERROR: drizzle-kit migrate exited ${MIGRATE_RC}"
  if [ "$MIGRATE_RC" -ge 128 ]; then
    log "that is 128+signal ${MIGRATE_RC}, i.e. signal $((MIGRATE_RC - 128)):"
    case $((MIGRATE_RC - 128)) in
      9)  log "  SIGKILL — most likely the host OOM killer. The container memory"
          log "  limit does not protect against this; check dmesg on the VPS." ;;
      6)  log "  SIGABRT" ;;
      11) log "  SIGSEGV" ;;
      15) log "  SIGTERM — something outside asked it to stop." ;;
      *)  log "  see 'kill -l' for the full list." ;;
    esac
  fi
  log "database URL host portion: $(printf '%s' "$DATABASE_URL" | sed 's#.*@##')"
  log "database URL user portion: $(printf '%s' "$DATABASE_URL" | sed -n 's#.*://\([^:]*\):.*#\1#p')"
  exit "$MIGRATE_RC"
fi

# ── serve ────────────────────────────────────────────────────────────────
log "starting server on :$PORT"
exec "$@"
