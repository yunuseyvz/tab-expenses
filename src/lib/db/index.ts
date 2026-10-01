/**
 * Postgres connection pool.
 *
 * Server-only. `createServerOnlyFn` is the identity function at runtime but is
 * swapped for a throwing stub by the Start Vite plugin in the client build, so
 * an accidental client import of DATABASE_URL is a build error rather than a
 * runtime leak.
 *
 * Note: the `server-only` npm package is the React/Next idiom and resolves via
 * the `react-server` export condition, which a plain Node server bundle does
 * not set — it throws at require time. Start has no RSC, so its own helper is
 * the correct one here.
 */
import { createServerOnlyFn } from '@tanstack/react-start'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from './env'
import * as schema from './schema'

let client: ReturnType<typeof postgres> | undefined
let db: ReturnType<typeof drizzle<typeof schema>> | undefined

export const getDb = createServerOnlyFn(function () {
  if (db) return db

  const e = env()
  client = postgres(e.DATABASE_URL, {
    max: e.NODE_ENV === 'production' ? 10 : 1,
    // Server functions are short-lived; fail fast rather than hang a request.
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => {},
  })

  db = drizzle(client, { schema, casing: 'snake_case' })
  return db
})

export type Db = ReturnType<typeof getDb>

/** Close the pool. Used by scripts and tests. */
export const closeDb = createServerOnlyFn(async function () {
  if (client) await client.end({ timeout: 5 })
  client = undefined
  db = undefined
})
