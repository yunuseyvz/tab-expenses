/**
 * LAYER 1 of the auth model: the navigation guard.
 *
 * `beforeLoad` fires on EVERY navigation, including client-side <Link> clicks
 * — a genuine advantage over a proxy.ts-style middleware that only sees HTTP
 * requests. This is UX, not security.
 *
 * LAYER 2 is `requireSpaceMember` inside every server function, and that is the
 * actual boundary: server functions are directly callable HTTP endpoints, and a
 * router guard is irrelevant to someone POSTing to them directly.
 */
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { RemovalNotice } from '#/components/RemovalNotice'
import {
  getRememberedSpaceId,
  getSession,
  listMySpaces,
} from '#/lib/auth.functions'
import { spaceKeys } from '#/lib/session'

export const Route = createFileRoute('/_protected')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      })
    }
    return { user: session.user }
  },
  // Warm the space list for every protected screen. Without this the first paint
  // is an empty shell, because every screen needs to know which space it is
  // showing before it can render anything.
  loader: async ({ context }) => {
    const [spaces, rememberedSpaceId] = await Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: spaceKeys.mySpaces,
        queryFn: () => listMySpaces(),
      }),
      getRememberedSpaceId(),
    ])

    // No space yet: onboard rather than into an empty dashboard.
    if (spaces.length === 0) {
      throw redirect({ to: '/setup' })
    }

    return { spaces, rememberedSpaceId }
  },
  component: ProtectedLayout,
})

function ProtectedLayout() {
  return (
    <>
      <Outlet />
      {/* Mounted here rather than inside AppShell, because AppShell is per-screen
          and this has to appear on whichever one the redirect below lands on. */}
      <RemovalNotice />
    </>
  )
}
