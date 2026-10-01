import { createFileRoute } from '@tanstack/react-router'

import { SetupForm } from '#/components/SetupForm'

export const Route = createFileRoute('/setup')({
  component: SetupRoute,
})

function SetupRoute() {
  return (
    <main id="main" className="min-h-dvh flex items-center justify-center p-5">
      <SetupForm />
    </main>
  )
}
