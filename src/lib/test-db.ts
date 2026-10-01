/**
 * Whether the integration tests can actually run.
 *
 * The suites need a real Postgres, but `pnpm test` should also work on a bare
 * checkout with no database at all. Presence of DATABASE_URL is not the right
 * test: a .env left over from a stopped dev stack satisfies it and then every
 * query fails with ECONNREFUSED, which reads as a broken test suite rather
 * than a missing service.
 *
 * So probe the connection once, up front. Unreachable means skip — loudly.
 * `REQUIRE_DB=true` turns an unreachable database into a hard failure instead,
 * which is what CI uses so a broken database is a red build rather than a
 * suite that quietly tested nothing.
 */
import postgres from 'postgres'

export const DB_URL = process.env.DATABASE_URL

let reachable: boolean | undefined

export async function databaseAvailable(): Promise<boolean> {
  if (reachable !== undefined) return reachable
  if (!DB_URL) {
    reachable = false
    return reachable
  }
  const client = postgres(DB_URL, { max: 1, connect_timeout: 3 })
  try {
    await client`select 1`
    reachable = true
  } catch {
    reachable = false
  } finally {
    await client.end({ timeout: 2 }).catch(() => {})
  }
  return reachable
}

/**
 * Use as `describe.runIf(await databaseAvailable())` in place of
 * `describe.skipIf(!DB_URL)`.
 */
export async function describeIfDatabase() {
  const ok = await databaseAvailable()
  if (!ok) {
    const reason = DB_URL
      ? `DATABASE_URL is set (${mask(DB_URL)}) but the database is not reachable`
      : 'DATABASE_URL is not set'
    if (process.env.REQUIRE_DB === 'true') {
      throw new Error(
        `REQUIRE_DB=true but the integration database is unavailable: ${reason}`,
      )
    }
    console.warn(
      `\n[test] SKIPPING database integration tests: ${reason}.\n` +
        `[test] Start one with: docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d\n`,
    )
  }
  return ok
}

function mask(url: string): string {
  return url.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@')
}
