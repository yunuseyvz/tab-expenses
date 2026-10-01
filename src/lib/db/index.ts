/**
 * Postgres connection pool.
 *
 * Imported only from server code (server functions, the Better Auth config,
 * scripts). The `server-only` import guard makes an accidental client import
 * a build-time error rather than a runtime leak of DATABASE_URL.
 */
import 'server-only'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from './env'
import * as schema from './schema'

let client: ReturnType<typeof postgres> | undefined
let db: ReturnType<typeof drizzle<typeof schema>> | undefined

export function getDb() {
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
}

export type Db = ReturnType<typeof getDb>

/** Close the pool. Used by scripts and tests. */
export async function closeDb() {
  if (client) await client.end({ timeout: 5 })
  client = undefined
  db = undefined
}
