import { createFileRoute, redirect } from '@tanstack/react-router'

import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/logout')({
  // A GET that mutates is a footgun (prefetch, crawlers). This is a placeholder
  // route so the sign-out button has a canonical URL; the real sign-out is a
  // POST from the shell.
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
  component: () => {
    void authClient
    return null
  },
})
