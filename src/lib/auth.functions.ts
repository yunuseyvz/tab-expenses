/**
 * Layer 2 of the auth model: server-function guards.
 *
 * `beforeLoad` on a route is UX only. It fires on navigation, including
 * client-side <Link> clicks, but it does NOT protect server functions — those
 * are directly callable HTTP endpoints, and a router guard is irrelevant to
 * someone POSTing to them directly.
 *
 * Every server function that reads or writes space data must call
 * `requireSpaceMember`. A single missing call is a cross-household data leak.
 */
import { createServerFn } from '@tanstack/react-start'
import {
  getCookie,
  getRequestHeaders,
  getRequestProtocol,
  setCookie,
} from '@tanstack/react-start/server'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { auth } from './auth'
import { getDb } from './db'
import { space, spaceMember, user } from './db/schema'

/**
 * Registration input. The name is the account name shown in the app; each
 * household still gets its own display name per space, so this is deliberately
 * not the same thing.
 */
const registrationSchema = z.object({
  name: z.string().trim().min(1, 'Tell us what to call you').max(80),
  email: z.email(),
})

/** Session for the current request, or null. Safe to call unauthenticated. */
export const getSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) return null
    return { user: session.user, session: session.session }
  },
)

export type SessionUser = NonNullable<
  Awaited<ReturnType<typeof getSession>>
>['user']

/** Session or throw. The baseline check for any authenticated operation. */
export const ensureSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await getSession()
    if (!session) {
      throw new Error('Unauthorized')
    }
    return session
  },
)

/**
 * Assert the current user is an active member of `spaceId`.
 *
 * Throws 404-flavoured errors on failure: a non-member should not be able to
 * distinguish "space does not exist" from "you are not in it".
 */
export async function requireSpaceMember(
  userId: string,
  spaceId: string,
): Promise<{ id: string; displayName: string; role: 'owner' | 'member' }> {
  const db = getDb()
  const [row] = await db
    .select({
      id: spaceMember.id,
      displayName: spaceMember.displayName,
      role: spaceMember.role,
    })
    .from(spaceMember)
    .where(
      and(
        eq(spaceMember.spaceId, spaceId),
        eq(spaceMember.userId, userId),
        isNull(spaceMember.archivedAt),
      ),
    )
    .limit(1)

  if (!row) {
    throw new Error('Not found')
  }
  return row
}

/** Same as above, but also requires the owner role. Used by settings. */
export async function requireSpaceOwner(userId: string, spaceId: string) {
  const member = await requireSpaceMember(userId, spaceId)
  if (member.role !== 'owner') {
    throw new Error('Not found')
  }
  return member
}

/**
 * Spaces the current user belongs to. Used by the space switcher and by
 * `/setup` to decide whether onboarding is needed.
 */
export const listMySpaces = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await ensureSession()
    const db = getDb()

    return db
      .select({
        id: space.id,
        name: space.name,
        currency: space.currency,
        // Carried so the switcher and the editor can show a household's mark
        // without a second round trip for data they already hold.
        icon: space.icon,
        role: spaceMember.role,
        memberId: spaceMember.id,
      })
      .from(spaceMember)
      .innerJoin(space, eq(spaceMember.spaceId, space.id))
      .where(
        and(
          eq(spaceMember.userId, session.user.id),
          isNull(spaceMember.archivedAt),
        ),
      )
      .orderBy(spaceMember.createdAt)
  },
)

/**
 * Does this address have an account?
 *
 * Exists so the sign-in form can say "no account for this address, create one"
 * instead of asking for a code that will never arrive and never work. That is a
 * deliberate reversal of what this function used to be careful about — see the
 * note on sendVerificationOTP below, which deliberately stays silent about
 * unknown addresses — and it is worth being straight about the cost.
 *
 * This *is* an account-existence oracle: anyone can POST an address and learn
 * whether it is registered here. What that is worth depends entirely on what
 * else the app does with an address, and here it is almost nothing: there are no
 * password resets, no third-party logins, no email-based identity to hijack, and
 * a login code goes only to the address itself. So the worst case is somebody
 * learning which of their housemates have accounts here, on a self-hosted
 * household app.
 *
 * It is bounded so it cannot be used to sweep a list. Better Auth's own rate
 * limiter covers its endpoints, not this server function, so the limit below is
 * ours: five lookups a minute, keyed on the caller's IP. A shared NAT address can
 * exhaust that and lock the form out for a minute, which is a nuisance rather
 * than a failure, and is the honest trade for not letting one client walk an
 * address book.
 *
 * Returns a boolean and nothing else — no name, no id, no verification state.
 */
export const emailIsRegistered = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ email: z.email() }))
  .handler(async ({ data }) => {
    const ip = clientIp()
    const now = Date.now()
    const hits = (LOOKUP_BUDGET.get(ip) ?? []).filter((t) => now - t < 60_000)

    // A status, not an exception. It first threw, and the client treated a
    // failed lookup as "don't know" and carried on to send a code — so hitting
    // the limit produced a confusing downstream failure instead of the message
    // explaining itself. Anything the caller is meant to *react* to differently
    // has to arrive as a value.
    if (hits.length >= LOOKUP_LIMIT) {
      return { status: 'limited' as const }
    }
    LOOKUP_BUDGET.set(ip, [...hits, now])

    const ctx = await auth.$context
    const existing = await ctx.internalAdapter.findUserByEmail(
      data.email.trim().toLowerCase(),
    )
    // `!= null` covers both null and undefined in one go, which is the only
    // reason to prefer it: the adapter's return type is not precise enough for
    // TypeScript to prove which of the two an absent user comes back as, and it
    // has been both.
    return { status: 'ok' as const, registered: existing != null }
  })

/** How many existence lookups one address may make per minute. */
const LOOKUP_LIMIT = 5

/**
 * Recent lookups, keyed by caller.
 *
 * In-process and therefore per-replica, which is fine: it is a courtesy limit
 * against a casual sweep, not a security control. The thing that actually
 * prevents abuse is that a lookup tells you nothing you could not already learn
 * by trying to sign in.
 */
const LOOKUP_BUDGET = new Map<string, Array<number>>()

/** The caller's IP, for the lookup budget. Best effort, never throws. */
function clientIp(): string {
  const headers = getRequestHeaders()
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown'
  return headers.get('x-real-ip')?.trim() ?? 'unknown'
}

/**
 * Begin registration: name + email in, a code in the inbox out.
 *
 * Better Auth's email-OTP plugin is configured with `disableSignUp: true`, so
 * verifying a code can never create an account on its own — which is what stops
 * a mistyped address on the login form from silently becoming a real, nameless
 * user. The consequence is that registration has to make the user row itself,
 * and it must do so *before* asking for the code: `sendVerificationOTP` only
 * mails an address it can already find, and quietly does nothing otherwise.
 *
 * So the order here is load-bearing:
 *   1. insert the user, unverified and with no session
 *   2. send the OTP
 *   3. the client posts the code to `signIn.emailOtp`, which promotes the
 *      account and opens the session
 *
 * Abandoning step 2 leaves an unverified user that cannot sign in anywhere, so
 * a half-finished registration is inert rather than dangerous. Re-running it
 * for the same address is safe and resends the code.
 */
export const startRegistration = createServerFn({ method: 'POST' })
  .inputValidator(registrationSchema)
  .handler(async ({ data: { name, email } }) => {
    const normalised = email.trim().toLowerCase()

    // Already registered: send them to sign in rather than creating a
    // duplicate that the unique index on email would reject anyway.
    const ctx = await auth.$context
    const existing = await ctx.internalAdapter.findUserByEmail(normalised)
    if (existing) return { status: 'exists' as const }

    await ctx.internalAdapter.createUser(
      {
        name: name.trim(),
        email: normalised,
        emailVerified: false,
      },
      { method: 'email-otp' },
    )

    // Now that the address resolves, this actually mails the code.
    await auth.api.sendVerificationOTP({
      body: { email: normalised, type: 'sign-in' },
    })

    return { status: 'sent' as const }
  })

// ── which space this browser is looking at ───────────────────────────────

/** Cookie name for the last space this browser used. Not a secret. */
export const SPACE_COOKIE = 'swl-space'

/**
 * Whether the space cookie may carry `Secure`.
 *
 * `Secure` is not a hardening flag here, it is a *permission slip*: a browser
 * refuses to store a `Secure` cookie that arrives over plain HTTP on an origin
 * that is not a secure context. So getting it wrong does not degrade the cookie,
 * it makes it not exist.
 *
 * It therefore has to follow the request the cookie is being set on, not the
 * deployment mode. Deriving it from NODE_ENV breaks the one case that matters
 * most — a production build reached over plain HTTP on a LAN or Tailscale name —
 * and it breaks silently: the server sends the header, the browser drops it, and
 * the only symptom is that the app forgets which household you were in.
 *
 * The same build, two origins:
 *
 *   http://localhost:3000   Chromium calls localhost a secure context, so
 *                           `Secure` is allowed and the cookie is kept.
 *   http://kaya:3000        Not a secure context. `Secure` is refused outright
 *                           and the cookie never arrives.
 *
 * `getRequestProtocol` reads X-Forwarded-Proto first, which is what Traefik sets
 * in front of the app in production, so this marks the cookie `Secure` behind
 * TLS and does not in front of it.
 *
 * Exported for the tests, because the failure it prevents is invisible: nothing
 * throws, the response looks right, and the bug surfaces only as a preference
 * that will not stick.
 */
export function secureSpaceCookie(protocol: string): boolean {
  return protocol === 'https'
}

/**
 * Remember which space to open by default.
 *
 * The URL's `?space=` wins when present, so this only decides what happens on a
 * bare /dashboard — which is the common case, because the nav links deliberately
 * do not carry a space and so must not pin one.
 *
 * That is also why the cookie has to survive. With no space in the nav links, a
 * cookie the browser quietly refuses does not degrade the app — it sends you
 * back to the first household the next time you change section.
 *
 * Membership is checked before the cookie is written. Without that, the cookie
 * would be an unchecked pointer into someone else's household that survives for
 * a year; resolveSpaceId would reject it on the way back in, but there is no
 * reason to store it in the first place.
 */
export const rememberSpace = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ spaceId: z.uuid() }))
  .handler(async ({ data: { spaceId } }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, spaceId)

    setCookie(SPACE_COOKIE, spaceId, {
      // Not httpOnly: it is a UI preference, not a credential, and letting the
      // client read it keeps the switcher honest without an extra round trip.
      // It is still only ever *hinted* at — resolveSpaceId re-checks it.
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      // The request's protocol, not NODE_ENV. See secureSpaceCookie above: the
      // old form made the cookie unstoreable on any plain-HTTP origin that is
      // not localhost, which is exactly where this bug was reported from.
      secure: secureSpaceCookie(getRequestProtocol()),
    })

    return { ok: true as const }
  })

/**
 * Unauthenticated callers get null rather than an error: the protected layout
 * already redirects them, and this is only a display preference.
 *
 * The value is returned raw. resolveSpaceId intersects it with the spaces the
 * user actually belongs to, which is the check that matters — a stale cookie
 * pointing at a household you left cannot open it.
 */
/**
 * The remembered space id, or null.
 *
 * POST, not GET, and that is the whole reason for it. This is the read the
 * protected layout's loader makes on *every* navigation, and it is the only way
 * a route without a `?space=` param learns which household it is showing — so a
 * response that is even slightly stale is a page full of the wrong household's
 * numbers.
 *
 * A GET here was a live hazard: no server function in this app sets a
 * Cache-Control header, so nothing forbids a browser from serving this from its
 * cache, and the value it would serve is the one from before the last switch.
 * The response is tiny and requested once per navigation, so a POST costs
 * nothing measurable, and a browser or proxy will not cache one. Guessing at
 * cache headers on a response this framework does not expose a header API for
 * is a worse guarantee than not being cacheable in the first place.
 */
export const getRememberedSpaceId = createServerFn({ method: 'POST' }).handler(
  async () => {
    const session = await ensureSession().catch(() => null)
    if (!session) return null

    return getCookie(SPACE_COOKIE) ?? null
  },
)

/**
 * Change your own avatar.
 *
 * Self-scoped on purpose: there is no spaceId to check membership against,
 * because this edits the caller's own account rather than anything a household
 * shares. The only reachable row is the one the session came from.
 */
export const updateProfile = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      avatar: z.string().trim().max(60).nullable().optional(),
      // The account name shown in the app. Household display names are per
      // space and stay untouched — this is only what "you" reads as.
      name: z
        .string()
        .trim()
        .min(1, 'Tell us what to call you')
        .max(80)
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    const db = getDb()

    if (data.avatar === undefined && data.name === undefined) {
      throw new Error('Nothing to save')
    }

    const [row] = await db
      .update(user)
      .set({
        ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
      })
      .where(eq(user.id, session.user.id))
      .returning({ id: user.id, avatar: user.avatar })

    if (!row) throw new Error('Not found')
    return row
  })
