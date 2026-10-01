#!/bin/sh
# Assert the schema's check constraints and cascades against a real database.
#
# The assertions live in verify-constraints.sql. This wrapper supplies the
# connection string so the same command works locally and in CI.
set -e

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a

echo "running constraint verification against $DATABASE_URL"

# If psql is available use it; otherwise go through the postgres.js driver in
# the seed script's style, so the check runs without a Postgres client install.
if command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/verify-constraints.sql"
else
  echo "psql not found; running the same assertions through postgres.js" >&2
  cd "$ROOT"
  node --experimental-strip-types -e "
    import postgres from 'postgres'
    import { readFileSync } from 'node:fs'
    const sql = postgres(process.env.DATABASE_URL, { max: 1 })
    const text = readFileSync('scripts/verify-constraints.sql', 'utf8')
    try {
      // Strip the psql meta-command and run the DO block as one statement.
      const body = text.replace(/^\\\\.*$/gm, '')
      await sql.unsafe(body)
      console.log('constraint verification passed')
    } finally {
      await sql.end({ timeout: 5 })
    }
  "
fi
