import { createFileRoute } from '@tanstack/react-router'

import { SetupForm } from '#/components/SetupForm'

/**
 * Create a second household.
 *
 * Same form as first-run onboarding, but a separate route: `/setup` means "you
 * have nothing", and conflating the two makes the back button and any future
 * "you need a space first" guard ambiguous. SetupForm already navigates into the
 * new space, so this is a redirect that lands you where you were going anyway.
 */
export const Route = createFileRoute('/spaces/new')({
  component: NewSpaceRoute,
})

function NewSpaceRoute() {
  return (
    <main id="main" className="min-h-dvh flex items-center justify-center p-5">
      <SetupForm
        title="New space"
        blurb="Another household, another ledger. Nothing is shared between spaces."
      />
    </main>
  )
}
