import { createFileRoute } from '@tanstack/react-router'

import { RemovalNotice } from '#/components/RemovalNotice'
import { SetupForm } from '#/components/SetupForm'

/**
 * First-run onboarding, and where you land with no household at all.
 *
 * There is no way past this screen, deliberately. A person with zero spaces has
 * nothing to look at and nothing to be blocked from — every screen in the app is
 * scoped to one — so the honest thing is to make them create one rather than
 * render a shell they can navigate around in.
 */
export const Route = createFileRoute('/setup')({
  component: SetupRoute,
})

function SetupRoute() {
  return (
    <main id="main" className="min-h-dvh flex items-center justify-center p-5">
      <SetupForm />
      {/* Also here, and this is the load-bearing one: being removed from your
          *only* household drops you to zero spaces, which redirects here, out of
          the protected layout entirely. Without it the person finds out by
          arriving at an empty form. */}
      <RemovalNotice />
    </main>
  )
}
