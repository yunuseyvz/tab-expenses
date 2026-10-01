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
  setCookie,
} from '@tanstack/react-start/server'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { auth } from './auth'
import { getDb } from './db'
import { env } from './db/env'
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
 * Remember which space to open by default.
 *
 * The URL's `?space=` wins when present, so this only decides what happens on a
 * bare /dashboard — which is the common case, because the nav links deliberately
 * do not carry a space and so must not pin one.
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
      secure: env().NODE_ENV === 'production',
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
  .inputValidator(z.object({ avatar: z.string().trim().max(60).nullable() }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    const db = getDb()

    const [row] = await db
      .update(user)
      .set({ avatar: data.avatar })
      .where(eq(user.id, session.user.id))
      .returning({ id: user.id, avatar: user.avatar })

    if (!row) throw new Error('Not found')
    return row
  })
