/**
 * Load .env for a Node script.
 *
 * `drizzle-kit` loads .env itself, which is why `pnpm db:migrate` works while
 * `pnpm db:seed` used to fail with "DATABASE_URL is required" — the script had
 * no reason to know about .env until nothing put the variables in its
 * environment. Scripts import this first thing instead of each reimplementing
 * the logic, and each stays runnable both inside and outside the shell
 * wrappers (dev-serve.sh, e2e.sh) that already export the variables.
 *
 * Already-set variables win, so an explicit environment always overrides the
 * file — which is what CI relies on.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadEnv(): void {
  // `process.loadEnvFile` is available on the Node versions this project
  // requires (>= 24). It does not overwrite existing variables, which is the
  // behaviour we want.
  if (typeof process.loadEnvFile !== 'function') return

  const file = resolve(process.cwd(), '.env')
  if (!existsSync(file)) return
  if (process.env.DATABASE_URL) return

  try {
    process.loadEnvFile(file)
  } catch (err) {
    // A malformed .env should not crash a script that might not need it; the
    // missing variable will produce a better error further down.
    console.warn(`[env] could not read .env: ${(err as Error).message}`)
  }
}
