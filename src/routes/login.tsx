import { createFileRoute } from '@tanstack/react-router'

import { LoginForm } from '#/components/LoginForm'

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === 'string' ? s.redirect : undefined,
  }),
  component: LoginRoute,
})

function LoginRoute() {
  const { redirect: to } = Route.useSearch()
  return (
    <main id="main" className="min-h-dvh flex items-center justify-center p-5">
      <LoginForm redirectTo={to} />
    </main>
  )
}
