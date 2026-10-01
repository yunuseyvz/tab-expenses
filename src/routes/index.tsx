import { createFileRoute, redirect } from '@tanstack/react-router'

import { getSession } from '#/lib/auth.functions'

export const Route = createFileRoute('/')({
  // Entry point: authenticated users go to the dashboard, everyone else to login.
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: undefined } })
    }
    throw redirect({
      to: '/dashboard',
      search: {
        space: undefined,
        period: 'thisMonth',
        cats: undefined,
        from: undefined,
        to: undefined,
      },
    })
  },
})
