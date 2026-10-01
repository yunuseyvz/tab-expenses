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

import { auth } from './auth'
import { getDb } from './db'
import { space, spaceMember } from './db/schema'

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
