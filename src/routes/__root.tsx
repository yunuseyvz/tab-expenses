import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import { Toaster } from '#/components/ui/sonner'
import { THEME_BOOTSTRAP } from '#/lib/theme'
import { APP_NAME } from '#/lib/app-meta'
import '#/styles/app.css'

/**
 * Declaring the router context on the root route is what gives every child
 * route its `context.queryClient` type. With a bare `createRootRoute`, children
 * only see what their parents' `beforeLoad` returned.
 */
export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: APP_NAME },
      {
        name: 'description',
        content: 'Shared household expense ledger with percentage splits.',
      },
      { name: 'theme-color', content: '#f4f4f1' },
    ],
    links: [
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootComponent() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/*
          Applies the theme class before the first paint. Inline and
          deliberately not a module: a deferred script would run after the
          first frame and cause a flash of the wrong theme.
        */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: must be
          // inline and synchronous to run before paint.
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
        />
      </head>
      <body>
        {/* Skip link: keyboard users land on content, not the nav. */}
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
