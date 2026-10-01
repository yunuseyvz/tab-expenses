/**
 * Mobile-first shell: bottom navigation on small screens, sidebar on desktop.
 * The entry point for this app is a phone at a checkout, so everything in the
 * primary flow has to work one-handed.
 */
import { useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  LayoutGrid,
  List,
  Scale,
  Settings as SettingsIcon,
} from 'lucide-react'

import { authClient } from '#/lib/auth-client'
import { cn } from '#/lib/cn'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { to: '/expenses', label: 'Expenses', icon: List },
  { to: '/balances', label: 'Balances', icon: Scale },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
] as const

/**
 * Validated search params are part of a route's identity, so every `Link` and
 * `navigate` must supply the full set. These are the defaults each screen falls
 * back to, centralised so the nav does not have to restate them at each call.
 */
const NAV_SEARCH = {
  '/dashboard': {
    space: undefined,
    period: 'thisMonth',
    cats: undefined,
    from: undefined,
    to: undefined,
  },
  '/expenses': {
    space: undefined,
    period: 'all',
    member: undefined,
    cats: undefined,
  },
  '/balances': { space: undefined, period: 'all' },
  '/settings': { space: undefined, period: 'all' },
} as const satisfies Record<(typeof NAV)[number]['to'], object>

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [signingOut, setSigningOut] = useState(false)

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="hidden md:flex items-center justify-between px-6 py-4 border-b border-rule">
        <Link
          to="/dashboard"
          search={NAV_SEARCH['/dashboard']}
          className="font-serif text-lg tracking-tight"
        >
          Splitwise
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          {NAV.map((item) => (
            <NavLink key={item.to} {...item} active={pathname === item.to} />
          ))}
        </nav>
        <button
          type="button"
          onClick={async () => {
            setSigningOut(true)
            await authClient.signOut()
            window.location.href = '/login'
          }}
          disabled={signingOut}
          className="text-sm text-ink-muted hover:text-ink"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </header>

      <div className="flex-1 pb-16 md:pb-0">{children}</div>

      {/* Bottom nav: the one-handed path. */}
      <nav
        aria-label="Main"
        className="md:hidden fixed bottom-0 inset-x-0 z-30
          bg-paper-raised border-t border-rule
          shadow-[0_-2px_8px_-4px_rgb(70_45_25/0.18)]"
      >
        <ul className="grid grid-cols-4">
          {NAV.map((item) => (
            <li key={item.to}>
              <BottomLink {...item} active={pathname === item.to} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

function NavLink({
  to,
  label,
  icon: Icon,
  active,
}: (typeof NAV)[number] & { active: boolean }) {
  return (
    <Link
      to={to}
      search={NAV_SEARCH[to]}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-[3px] text-sm',
        'transition-[background-color,color] duration-150',
        active
          ? 'bg-paper-sunk text-ink shadow-[var(--shadow-deboss)]'
          : 'text-ink-muted hover:text-ink',
      )}
    >
      <Icon size={16} aria-hidden />
      {label}
    </Link>
  )
}

function BottomLink({
  to,
  label,
  icon: Icon,
  active,
}: (typeof NAV)[number] & { active: boolean }) {
  return (
    <Link
      to={to}
      search={NAV_SEARCH[to]}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 h-16',
        'text-[11px] transition-colors duration-150',
        active ? 'text-terracotta-ink' : 'text-ink-muted',
      )}
    >
      {/* The active indicator is a shape change, not only a colour change. */}
      <span
        aria-hidden
        className="h-0.5 w-6 rounded-full transition-colors duration-150"
        style={{
          background: active ? 'var(--color-terracotta)' : 'transparent',
        }}
      />
      <Icon size={20} aria-hidden />
      {label}
    </Link>
  )
}

/**
 * A bottom sheet on mobile, an inline panel on desktop. Springs up from the
 * bottom edge, slightly under-damped so it settles with a little weight.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="fixed inset-0 z-40 bg-[rgb(70_45_25/0.32)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto
              bg-paper-raised rounded-t-lg pb-6
              shadow-[var(--shadow-float)]"
          >
            {/* Debossed drag handle. */}
            <div className="flex justify-center pt-3 pb-1">
              <span
                aria-hidden
                className="h-1.5 w-10 rounded-full bg-rule
                  shadow-[var(--shadow-deboss)]"
              />
            </div>
            <div className="flex items-center justify-between px-5 py-2">
              <h2 className="font-serif text-xl">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-ink-muted hover:text-ink"
              >
                Close
              </button>
            </div>
            <div className="px-5 pt-2">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
