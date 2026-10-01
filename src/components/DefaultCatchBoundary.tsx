import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/Button'

export function DefaultCatchBoundary({ error }: { error: unknown }) {
  // The CSRF middleware and server-function guards throw plain values, not
  // always Error instances, so normalise before rendering.
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error)

  return (
    <main
      id="main"
      className="min-h-dvh flex items-center justify-center p-6"
    >
      <div className="card max-w-md w-full p-6">
        <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-sm text-ink-muted mb-4 break-words">{message}</p>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Link to="/">
            <Button variant="secondary">Go home</Button>
          </Link>
        </div>
      </div>
    </main>
  )
}
