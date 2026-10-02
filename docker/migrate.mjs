// Applies pending migrations at boot.
//
// This replaces `drizzle-kit migrate`, which was the only thing the entrypoint
// ran against the database and which exits 1 printing nothing at all when it
// fails. Its spinner is cut off mid-draw, so the log ends with a fragment of
// ANSI escape codes and no cause. Costing a full diagnosis cycle on the deployed
// instance is what this file exists to prevent: every hypothesis has to be
// ruled out from the outside because the log does not contain the answer.
//
// `migrate()` is the same function drizzle-kit calls internally, reading the
// same journal from the same folder and recording the same hashes, so the
// applied state is identical. What changes is the failure path: a try/catch
// that prints the message, the Postgres error fields, and the stack.
//
// It also drops two dependencies the CLI needed and this does not:
//   - `pg`, which drizzle-kit requires but which is not resolvable at the top
//     level of node_modules. It lives inside drizzle-kit's own dependency tree.
//   - esbuild, which the CLI used to transpile drizzle.config.ts before reading
//     a path out of it. Here the folder is passed in directly, so no TypeScript
//     is loaded at migration time at all.

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const folder = process.env.MIGRATIONS_FOLDER ?? '/app/drizzle'
const url = process.env.DATABASE_URL

if (!url) {
  console.error('[migrate] DATABASE_URL is not set')
  process.exit(2)
}

const sql = postgres(url, {
  max: 1,
  connect_timeout: 15,
  // Postgres NOTICE chatter is not interesting here and only dilutes the log.
  onnotice: () => {},
})

try {
  await migrate(drizzle(sql), { migrationsFolder: folder })
  console.log('[migrate] migrations applied')
} catch (err) {
  console.error('[migrate] FAILED')
  console.error(`[migrate]   ${err?.message ?? err}`)

  // The fields Postgres sets on a failed statement. Without them a syntax or
  // permissions error is just a sentence, and the sentence rarely says which
  // object was at fault.
  for (const field of ['code', 'severity', 'detail', 'hint', 'position', 'schema', 'table']) {
    if (err?.[field] !== undefined) console.error(`[migrate]   ${field}: ${err[field]}`)
  }

  if (err?.cause) console.error(`[migrate]   cause: ${err.cause.message ?? err.cause}`)

  if (err?.stack) {
    console.error('[migrate]   stack:')
    for (const line of String(err.stack).split('\n')) console.error(`[migrate]     ${line}`)
  }

  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 }).catch(() => {})
}