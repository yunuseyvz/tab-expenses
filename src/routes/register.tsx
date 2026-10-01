import { createFileRoute } from '@tanstack/react-router'

import { RegisterForm } from '#/components/RegisterForm'

export const Route = createFileRoute('/register')({
  // Carried over from the login form's "Create an account" link, so a user who
  // mistyped an address does not have to type it a second time.
  validateSearch: (s: Record<string, unknown>) => ({
    email: typeof s.email === 'string' ? s.email : undefined,
  }),
  component: RegisterRoute,
})

function RegisterRoute() {
  const { email } = Route.useSearch()
  return (
    <main id="main" className="min-h-dvh flex items-center justify-center p-5">
      <RegisterForm initialEmail={email} />
    </main>
  )
}
