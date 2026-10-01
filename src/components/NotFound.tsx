import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/Button'

export function NotFound() {
  return (
    <main id="main" className="min-h-dvh flex items-center justify-center p-6">
      <div className="text-center">
        <p className="text-sm text-ink-faint uppercase tracking-[0.12em]">
          404
        </p>
        <h1 className="text-2xl font-semibold mt-1 mb-4">Page not found</h1>
        <Link to="/">
          <Button variant="secondary">Go home</Button>
        </Link>
      </div>
    </main>
  )
}
