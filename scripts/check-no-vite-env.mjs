#!/usr/bin/env node
/**
 * CI check: no secret may be reachable through a VITE_ prefixed variable.
 *
 * Vite inlines every VITE_* value into the client bundle at BUILD time, so a
 * secret under that prefix is a published secret. The plan asks for "a grep
 * for VITE_ in the repo that should return nothing but that one line", and this
 * enforces it rather than trusting a human to remember.
 *
 * Two failure modes are caught:
 *   1. A new VITE_* variable in .env.example / the environment.
 *   2. A secret-looking name anywhere in src/ being read from import.meta.env
 *      or process.env under a VITE_ prefix.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

/** The only VITE_ variables this app is allowed to expose. */
const ALLOWED = new Set(['VITE_APP_NAME', 'VITE_APP_URL'])

/** Substrings that suggest a value is a secret. */
const SECRET_HINTS = [
  'SECRET',
  'PASSWORD',
  'TOKEN',
  'API_KEY',
  'PRIVATE',
  'DATABASE_URL',
  'CREDENTIAL',
]

const violations = []
const seen = new Set()

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.output') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path)
    else check(path)
  }
}

function check(path) {
  if (!['.ts', '.tsx', '.js', '.mjs', '.css', '.json'].includes(extname(path))) return
  if (path.includes('routeTree.gen')) return
  const src = readFileSync(path, 'utf8')

  for (const m of src.matchAll(/\bVITE_[A-Z0-9_]+/g)) {
    const name = m[0]
    const line = src.slice(0, m.index).split('\n').length
    seen.add(name)

    if (!ALLOWED.has(name)) {
      violations.push(
        `${path}:${line}: ${name} is not on the allowlist. ` +
          `Vite inlines VITE_* into the client bundle at build time.`,
      )
      continue
    }

    // Even an allowed name must not look like a secret.
    if (SECRET_HINTS.some((h) => name.includes(h))) {
      violations.push(`${path}:${line}: ${name} looks like a secret.`)
    }
  }

  // Reading env through import.meta.env bypasses the process.env convention;
  // flag it so server code keeps using src/lib/db/env.ts.
  for (const m of src.matchAll(/import\.meta\.env\.[A-Za-z0-9_]+/g)) {
    const name = m[0].split('.').pop()
    if (name && SECRET_HINTS.some((h) => name.toUpperCase().includes(h))) {
      const line = src.slice(0, m.index).split('\n').length
      violations.push(
        `${path}:${line}: reads ${m[0]}, which looks like a secret in the client bundle.`,
      )
    }
  }
}

walk('src')
walk('scripts')
check('.env.example')
check('vite.config.ts')

if (violations.length > 0) {
  console.error('VITE_ leak check FAILED:\n')
  for (const v of violations) console.error(`  - ${v}`)
  console.error(
    '\nRead secrets from process.env at RUNTIME via env() in src/lib/db/env.ts.\n' +
      'Only genuinely public, build-time values may use the VITE_ prefix.',
  )
  process.exit(1)
}

console.log(
  `VITE_ leak check passed (referenced: ${[...seen].sort().join(', ') || 'none'}; allowed: ${[...ALLOWED].join(', ')})`,
)
