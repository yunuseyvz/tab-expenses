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
import { getRequestHeaders } from '@tanstack/react-start/server'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { auth } from './auth'
import { getDb } from './db'
import { space, spaceMember } from './db/schema'

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
