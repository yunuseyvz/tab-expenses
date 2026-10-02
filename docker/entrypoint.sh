#!/bin/sh
# Container entrypoint: wait for the database, migrate, then serve.
#
# Migrations run on boot. That is safe for the single-instance deployment this
# is written for. If you ever run more than one replica, move this to a
# separate one-shot job — concurrent migration runs can race on the
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

  # Now actually authenticate. The loop above only proves a TCP socket opened, so
  # it reports success for a password that can never log in. That mistake already
  # cost a deploy cycle here.
  #
  # The extra check exists for the hint, not the detection: migrate.mjs already
  # reports "password authentication failed". What it cannot know is why the
  # password is wrong. A `pgdata` volume keeps the password it was created with,
  # and when the directory already exists Postgres logs "Skipping initialization"
  # and ignores POSTGRES_PASSWORD entirely. So changing the password after the
  # first deploy silently invalidates it, and that is the single most likely
  # reason for a mismatch on a redeploy.
  #
  # `postgres` rather than `pg`: that is the driver the app itself uses, so it is
  # resolvable at the top level of node_modules. `pg` is not — it exists only
  # inside drizzle-kit's own dependency tree, which the Dockerfile's pruning step
  # can move, and reaching for it here produced MODULE_NOT_FOUND.
  #
  # Nothing is sent to /dev/null: these messages are the entire point.
  if ! node -e '
    const postgres = require("postgres");
    const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10 });
    sql`select 1`
      .then(() => { console.log("[entrypoint] database credentials accepted"); return sql.end(); })
      .catch((e) => {
        const m = String((e && e.message) || e);
        if (/password authentication failed|no pg_hba\.conf entry|does not exist/.test(m)) {
          console.error("[entrypoint] THE DATABASE REJECTED THE CREDENTIALS: " + m);
          console.error("[entrypoint] If POSTGRES_PASSWORD was changed after the first deploy,");
          console.error("[entrypoint] the pgdata volume still holds the original one, and Postgres");
          console.error("[entrypoint] ignores the new value because the directory already exists.");
          console.error("[entrypoint] Set it back to the original, or delete the volume for a fresh db.");
        } else {
          console.error("[entrypoint] could not connect to the database: " + m);
        }
        process.exit(2);
      });
  '; then
    exit 2
  fi
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
# evidence was a progress spinner cut off mid-draw.
#
# `cmd || RC=$?` rather than `cmd; RC=$?`: this script runs under `set -e`, so a
# bare failing command exits the container on the spot and the exit code is never
# read. Handling it in the `||` arm is what keeps the reporting below reachable.
#
# The CLI is gone from this path on purpose. `drizzle-kit migrate` exits 1 and
# prints nothing when it fails, so the log ends mid-spinner with a fragment of
# ANSI codes and no cause — which is what made a deploy failure cost a full
# diagnosis cycle from the outside. docker/migrate.mjs runs the same migration
# through the same journal, but inside a try/catch that reports the error.
log "applying migrations"
MIGRATE_RC=0
set -x
node ./migrate.mjs || MIGRATE_RC=$?
set +x

if [ "$MIGRATE_RC" -ne 0 ]; then
  log "ERROR: migrations failed, rc=${MIGRATE_RC} (see [migrate] lines above)"

  # The migrator now names its own failure, so what is left is the context it
  # cannot see: the host's disk and memory. A full filesystem makes a
  # file-writing process die without a message, and this image is large.
  log "disk:"
  df -h / /tmp /app 2>&1 | sed "s/^/[entrypoint]   /"
  log "memory:"
  free -m 2>&1 | sed "s/^/[entrypoint]   /" || echo "[entrypoint]   free unavailable"
  log "migrations on disk:"
  ls /app/drizzle/*.sql 2>&1 | sed "s/^/[entrypoint]   /"
  if touch /app/drizzle/.write-test 2>&1; then
    log "drizzle folder is writable"
    rm -f /app/drizzle/.write-test
  else
    log "drizzle folder is NOT writable"
  fi
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
