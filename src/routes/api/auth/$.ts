/**
 * Better Auth handler mount point.
 *
 * The `$` splat covers every /api/auth/* path. Cookie writes are handled by
 * the `tanstackStartCookies()` plugin in src/lib/auth.ts.
 */
import { createFileRoute } from '@tanstack/react-router'
import { auth } from '#/lib/auth'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => auth.handler(request),
      POST: async ({ request }: { request: Request }) => auth.handler(request),
    },
  },
})
