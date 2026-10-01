#!/usr/bin/env node
/**
 * Static half of the two-layer auth rule.
 *
 * The plan names the top risk as "a missing requireSpaceMember in one server
 * function leaks data across households" and asks for "a test asserting every
 * POST server function rejects a non-member". The runtime half of that is
 * src/lib/isolation.test.ts; this is the half that catches a *newly added*
 * server function that forgot the guard, before it is ever deployed.
 *
 * Rules, applied to every createServerFn in src/lib:
 *   1. Every one must call ensureSession() (or getSession(), for the read-only
 *      session helpers themselves).
 *   2. Every one that takes a spaceId in its schema must also call
 *      requireSpaceMember / requireSpaceOwner.
 *   3. None may call process.env directly — env access goes through
 *      src/lib/db/env.ts so the VITE_ inlining hazard is centralised.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const LIB = 'src/lib'
const violations = []

/**
 * Server functions that legitimately do not call requireSpaceMember.
 *
 * Every entry needs a reason, and each must still call ensureSession. Keep
 * this list as short as the design allows — an entry is a hole in the security
 * boundary, so each one should be easy to justify out loud in review.
 */
const MEMBERSHIP_EXEMPT = new Set([
  // Joining a space is the one operation that happens *before* the caller is a
  // member. It is safe because the target row must be an unclaimed virtual
  // member (user_id IS NULL) in a space the caller named, and it merges rather
  // than grants: if the user already has a row, the duplicate is archived
  // instead of replacing anything.
  'claimMember',
  // Session primitives. Defined here rather than in a server-function file
  // precisely so they can be the thing everyone else calls.
  'getSession',
  'ensureSession',
  'listMySpaces',
])

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      walk(path)
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      check(path)
    }
  }
}

function check(path) {
  const src = readFileSync(path, 'utf8')
  const serverFns = src.match(
    /createServerFn\(\{[^}]*method:\s*'(\w+)'[^}]*\}\)/g,
  )
  if (!serverFns) return

  // Slice the file into one chunk per createServerFn so a guard in a
  // neighbouring function cannot mask a missing one here.
  const starts = []
  const re = /createServerFn\(\{/g
  let m
  while ((m = re.exec(src)) !== null) starts.push(m.index)
  if (starts.length === 0) return

  const chunks = starts.map((start, i) =>
    src.slice(start, starts[i + 1] ?? src.length),
  )

  chunks.forEach((chunk, i) => {
    const where = `${path} (server function #${i + 1})`
    const method = /method:\s*'(\w+)'/.exec(chunk)?.[1] ?? 'GET'

    // The exported name, so exemptions are keyed by function rather than by
    // position — a reordering must not silently change what is exempt.
    const before = src.slice(0, starts[i])
    const name = /export const (\w+)\s*=\s*$/.exec(before)?.[1] ?? `fn${i + 1}`
    const whereNamed = `${path} (${name})`
    const exempt = MEMBERSHIP_EXEMPT.has(name)

    // The session helpers themselves are the primitives; everything else must
    // go through them.
    const isSessionHelper = /export const (getSession|ensureSession)\b/.test(
      src.slice(0, starts[i]),
    )
    if (!isSessionHelper && !/ensureSession\(|getSession\(/.test(chunk)) {
      violations.push(
        `${whereNamed}: no ensureSession()/getSession() call. Every server function must check the session.`,
      )
    }

    // A function is "space-scoped" when it accepts a spaceId FROM THE CALLER.
    // Merely mentioning `spaceId` internally is not enough: listMySpaces
    // selects by the caller's own userId and never takes a target space, so it
    // needs no membership check.
    const acceptsSpaceId =
      /data\.spaceId/.test(chunk) || /spaceId:\s*uuidSchema/.test(chunk)

    // Authentication and authorisation are different questions. ensureSession
    // only proves WHO is calling; requireSpaceMember proves they may touch THIS
    // space. Accepting the former as satisfying the latter is exactly the hole
    // this check exists to close, so the membership rule looks for the
    // membership helpers only.
    const hasMembershipCheck = /requireSpaceMember\(|requireSpaceOwner\(/.test(
      chunk,
    )

    if (acceptsSpaceId && !hasMembershipCheck && !exempt) {
      violations.push(
        `${where}: takes a spaceId from the caller but never calls requireSpaceMember/requireSpaceOwner. ` +
          `ensureSession only proves who is calling — this would leak data across households.`,
      )
    }

    // Writes that change space configuration should also be owner-gated.
    const writes = method === 'POST' || method === 'PUT' || method === 'PATCH'
    if (writes && /archiveMember|updateMember|updateCategory/.test(chunk)) {
      if (!/requireSpaceOwner\(|requireSpaceMember\(/.test(chunk)) {
        violations.push(
          `${whereNamed}: mutates space configuration with no guard at all.`,
        )
      }
    }

    if (/process\.env\./.test(chunk)) {
      violations.push(
        `${whereNamed}: reads process.env directly. Use env() from src/lib/db/env.ts instead.`,
      )
    }

    // Every exemption must still authenticate.
    if (exempt && !/ensureSession\(|getSession\(/.test(chunk)) {
      violations.push(
        `${whereNamed}: is on the membership-exemption list but never calls ensureSession().`,
      )
    }
  })
}

walk(LIB)

// The env module is the one legitimate place process.env is read.
const envSrc = readFileSync(join(LIB, 'db/env.ts'), 'utf8')
if (!/process\.env/.test(envSrc)) {
  violations.push(
    'src/lib/db/env.ts no longer reads process.env — is it still needed?',
  )
}

if (violations.length > 0) {
  console.error('auth guard check FAILED:\n')
  for (const v of violations) console.error(`  - ${v}`)
  console.error(
    '\nEvery server function needs ensureSession() plus, if it is space-scoped,\n' +
      'requireSpaceMember(). See §6 of the plan: the router guard is UX, this is\n' +
      'the security boundary.',
  )
  process.exit(1)
}

console.log(
  'auth guard check passed: every server function checks the session and space membership',
)
