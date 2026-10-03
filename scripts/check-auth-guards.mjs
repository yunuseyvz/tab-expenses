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

/**
 * Server functions reachable without a session at all.
 *
 * A much shorter list than MEMBERSHIP_EXEMPT and a far bigger hole: an entry
 * here is callable by anyone. Keep it that way — adding a name here is how a
 * data leak would get in, so each one must be readable as "what exactly is
 * there to protect?".
 */
const UNAUTHENTICATED_EXEMPT = new Set([
  // What an emailed invitation says, shown on /invite/$token to someone who is
  // not signed in yet. Returns the household's name, the invited address and the
  // inviter's display name — nothing from the ledger, and no id that could be
  // used to reach one. The token is the credential; this only describes it.
  'getInvitePreview',
  // Creating an account. There is no session to check because the account does
  // not exist yet — that is what the caller is asking for. What it grants is
  // deliberately nothing: it writes one unverified user row and mails a code.
  // It cannot be logged into until that code is verified, it reads nothing, and
  // it grants no access to any space.
  'startRegistration',
  // Whether an address has an account, so the sign-in form can say so instead of
  // asking for a code that will never arrive. A boolean and nothing else — no
  // name, no id, no verification state — and it is rate limited to five lookups
  // a minute per caller. See emailIsRegistered in src/lib/auth.functions.ts for
  // why the oracle is cheap in this app: no password resets, no third-party
  // logins, and a login code only ever goes to the address itself.
  'emailIsRegistered',
])

/**
 * Per-row edit guards a handler may delegate to instead of inlining.
 *
 * A name here means "this function compares the expense's creator against the
 * caller". Nothing else counts: the point of the guard is that the comparison
 * happens, and accepting arbitrary indirection would let it pass without one.
 */
const CREATOR_GUARDS = ['assertMayEdit']

/**
 * Handlers that write to the expense ledger without a per-row creator check, and
 * why that is correct.
 *
 * Keep this as short as the design allows — every entry is a way to change what
 * somebody is shown they spent.
 */
const EXPENSE_WRITE_EXEMPT = new Set([
  // Creating an expense stamps it with the caller, so there is no earlier author
  // to protect: the row being written *is* yours by construction.
  'createExpense',
  // A CSV import does the same, in bulk. Every row it creates is the caller's,
  // for the same reason.
  'commitImport',
  // Deleting your own account removes the expenses you entered, which is the
  // point of deleting it. The authorisation is the session plus the address
  // being retyped; there is no "other author" to protect, because the caller is
  // the author of every row this touches.
  'purgeAccount',
  // A whole-space delete. Already owner-gated by its caller (deleteSpace), and
  // purgeSpace is not a server function so it has no session of its own — the
  // guard lives at the edge by design, the same split as purgeAccount.
  'purgeSpace',
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
  // Boundaries are every top-level declaration, not just createServerFn. Slicing
  // on the server-function marker alone attributes a plain exported helper to
  // whichever server function precedes it, so `purgeAccount` — which legitimately
  // deletes expenses — was reported as part of accountDeletionPreview.
  const boundaries = [
    ...src.matchAll(/^(?:export\s+)?(?:const|async function|function)\s+\w+/gm),
  ]
    .map((mm) => mm.index)
    .sort((a, b) => a - b)
  if (boundaries.length === 0) return

  // A declaration is a server function when a createServerFn call appears in the
  // text that follows it and before the next declaration. Matching on "the next
  // declaration is this far away" rather than trying to pattern-match the
  // declaration's own signature, which is what made an earlier version of this
  // find zero server functions and silently pass everything.
  const chunks = boundaries
    .map((start, i) => ({
      start,
      text: src.slice(start, boundaries[i + 1] ?? src.length),
    }))
    .filter(({ text }) => text.includes('createServerFn({'))
  if (chunks.length === 0) return

  chunks.forEach(({ start, text: chunk }, i) => {
    const where = `${path} (server function #${i + 1})`
    const method = /method:\s*'(\w+)'/.exec(chunk)?.[1] ?? 'GET'

    // The exported name, so exemptions are keyed by function rather than by
    // position — a reordering must not silently change what is exempt.
    //
    // Read from the chunk's own first line rather than from the text *before* the
    // boundary: the boundary is the start of `export const NAME`, so the name is
    // inside the chunk and never in what precedes it. Reading it from `before`
    // only worked for the multi-line `export const x =\n  createServerFn(…)` form
    // and returned `fn1` for everything else, which silently disabled every
    // exemption keyed by name.
    const name =
      /^export const (\w+)/.exec(chunk)?.[1] ??
      /^(?:async )?function (\w+)/.exec(chunk)?.[1] ??
      `fn${i + 1}`
    const whereNamed = `${path} (${name})`
    const exempt = MEMBERSHIP_EXEMPT.has(name)
    const publicFn = UNAUTHENTICATED_EXEMPT.has(name)

    // The session helpers themselves are the primitives; everything else must go
    // through them. Keyed on the resolved name, not on "does ensureSession
    // appear somewhere earlier in this file" — the latter is true for every
    // function declared after it, which silently exempted the rest of the file.
    const isSessionHelper = name === 'getSession' || name === 'ensureSession'
    if (
      !isSessionHelper &&
      !publicFn &&
      !/ensureSession\(|getSession\(/.test(chunk)
    ) {
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

    // Per-row edit rights, which the membership check above cannot see. A member
    // of a space may *read* every expense in it; whether they may *change* one
    // depends on who entered it and on the household's setting. Asserted here
    // because a regression here is a member quietly rewriting somebody else's
    // entries — and the membership guard above would still pass.
    const writesExpense =
      /\.update\(expense\)|\.delete\(expense\)|insert\(expense\)/.test(chunk)
    if (writesExpense && !EXPENSE_WRITE_EXEMPT.has(name)) {
      const ownerGated = /requireSpaceOwner\(/.test(chunk)
      // Either a call to one of the named helpers, or an explicit comparison.
      //
      // Both halves matter, and getting this wrong is how a guard that looks
      // present passes while nothing compares anything. Merely *mentioning*
      // createdByUserId and session.user.id in the same handler is not a check:
      // deleteExpense selects createdByUserId only to hand it to the helper, so
      // with the helper call deleted both identifiers are still in the text and a
      // looser rule keeps passing. Hence the explicit operator, and the helper
      // allowlist — arbitrary indirection would satisfy this without anything
      // comparing the two, which is the hole being closed.
      const checksCreator =
        CREATOR_GUARDS.some((fn) => chunk.includes(`${fn}(`)) ||
        /createdByUserId\s*[!=]==?\s*[\w.]*session\.user\.id|session\.user\.id\s*[!=]==?\s*[\w.]*createdByUserId/.test(
          chunk,
        )
      if (!ownerGated && !checksCreator) {
        violations.push(
          `${whereNamed}: writes to the expense ledger without checking who entered it. ` +
            `Either gate on requireSpaceOwner, or compare createdByUserId with session.user.id.`,
        )
      }
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

    // A public function must also not be space-scoped. That combination is how a
    // cross-household read happens by accident, so refuse the combination
    // outright rather than trusting the name list to never contain both.
    if (publicFn && acceptsSpaceId) {
      violations.push(
        `${whereNamed}: is public but takes a spaceId from the caller. A public function must not reach into a household.`,
      )
    }

    // Every membership exemption must still authenticate.
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
