/**
 * LAYER 1 of the auth model: the navigation guard.
 *
 * `beforeLoad` fires on EVERY navigation, including client-side <Link> clicks
 * — a genuine advantage over a proxy.ts-style middleware that only sees HTTP
 * requests. This is UX, not security.
 *
 * LAYER 2 is `requireSpaceMember` inside every server function, and that is the
 * actual boundary: server functions are directly callable HTTP endpoints, and
 * a router guard is irrelevant to someone POSTing to them directly.
 */
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { getSession, listMySpaces } from '#/lib/auth.functions'

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
  loader: () => listMySpaces(),
  component: ProtectedLayout,
})

function ProtectedLayout() {
  const spaces = useQuery({
    queryKey: ['my-spaces'],
    queryFn: () => listMySpaces(),
  })

  // No space yet: send them to onboarding rather than into an empty dashboard.
  if (spaces.isSuccess && spaces.data.length === 0) {
    throw redirect({ to: '/setup' })
  }

  return <Outlet />
}
