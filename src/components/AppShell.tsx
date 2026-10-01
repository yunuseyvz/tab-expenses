/**
 * Mobile-first shell: a floating sidebar on desktop, a bottom bar on mobile.
 *
 * The entry point for this app is a phone at a checkout, so everything in the
 * primary flow has to work one-handed — which is why the phone layout is the
 * one that is designed first and the desktop one adapted.
 *
 * The desktop sidebar replaced a full-width header bar. Three things were wrong
 * with it: the nav was centred while the brand was pinned left and the sign-out
 * pinned right, so nothing lined up on a wide screen; it consumed a full row of
 * vertical space for four items that fit in a column; and a 1920px-wide bar with
 * four links in the middle of it is mostly empty. A floating panel puts the
 * navigation somewhere the eye already goes, and leaves the content area to the
 * content.
 */
import { useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  LayoutGrid,
  List,
  LogOut,
  Scale,
  Settings as SettingsIcon,
} from 'lucide-react'

import { SpaceSwitcher } from '#/components/SpaceSwitcher'
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
 *
 * They deliberately carry no `space`: the remembered-space cookie decides which
 * household a bare navigation lands in. Pinning one here would quietly make the
 * nav useless for anyone with two.
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

  async function signOut() {
    setSigningOut(true)
    await authClient.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[auto_1fr]">
      {/* ── desktop: floating sidebar ──────────────────────────────────── */}
      <aside className="hidden md:block">
        <div
          className="sticky top-0 flex h-dvh flex-col gap-1 p-4
            w-[15.5rem]"
        >
          <div
            className="flex-1 flex flex-col gap-1 rounded-[var(--radius-2xl)]
              border border-rule/60 p-2.5
              bg-[var(--surface-material)]
              backdrop-blur-[var(--material-blur)]
              shadow-[var(--shadow-float),var(--material-edge)]"
          >
            <Link
              to="/dashboard"
              search={NAV_SEARCH['/dashboard']}
              className="px-2.5 pt-2 pb-3.5 font-serif text-lg tracking-tight"
            >
              Tally
            </Link>

            {/* A dedicated section for the household, separated from the nav
                by a rule: which space you are in is not one of the four places
                you can be, and putting it among them made it read as a tab. */}
            <div className="px-1 pb-3">
              <p
                className="px-2 pb-1.5 text-[10px] font-semibold uppercase
                tracking-[0.12em] text-ink-faint"
              >
                Spaces
              </p>
              <SpaceSwitcher variant="panel" />
            </div>

            <div className="h-px bg-[var(--color-rule)]/70 mb-2" />

            <nav aria-label="Main" className="flex flex-col gap-1">
              {NAV.map((item) => (
                <SidebarLink
                  key={item.to}
                  {...item}
                  active={pathname === item.to}
                />
              ))}
            </nav>

            {/* Pushed to the bottom rather than sitting under the nav: signing
                out is not a peer of going to Balances. */}
            <div className="mt-auto pt-3 border-t border-rule/70">
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={signingOut}
                className="w-full flex items-center gap-2.5 rounded-[var(--radius-md)]
                  px-2.5 py-2 text-sm text-ink-muted
                  transition-[background-color,color] duration-150
                  hover:bg-[var(--color-paper-sunk)] hover:text-ink
                  active:scale-[0.98] motion-reduce:active:scale-100"
              >
                <LogOut size={17} aria-hidden />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── mobile: top bar ───────────────────────────────────────────── */}
      {/* No settings gear here: that screen is already one of the four bottom
          tabs, so a second route to it in the corner is redundant. The right
          slot is the account, which is the one thing the bottom bar cannot
          reach. */}
      <div
        className="md:hidden sticky top-0 z-30 flex items-center justify-between
        px-4 h-12 border-b border-rule
        backdrop-blur-[var(--material-blur)]
        bg-[var(--surface-material)]
        shadow-[var(--material-edge)]"
      >
        <SpaceSwitcher compact />
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={signingOut}
          aria-label={signingOut ? 'Signing out' : 'Sign out'}
          className="text-ink-muted p-1.5 -mr-1.5 rounded-full
            transition-colors duration-150 hover:text-ink
            active:scale-95 motion-reduce:active:scale-100"
        >
          <LogOut size={18} aria-hidden />
        </button>
      </div>

      <div className="flex-1 min-w-0 pb-20 md:pb-0">{children}</div>

      {/* ── mobile: bottom nav ────────────────────────────────────────── */}
      <nav
        aria-label="Main"
        className="md:hidden fixed bottom-0 inset-x-0 z-30
          border-t border-rule
          backdrop-blur-[var(--material-blur)]
          bg-[var(--surface-material)]
          shadow-[var(--material-edge),0_-4px_16px_-6px_rgb(70_45_25/0.2)]"
      >
        <ul className="grid grid-cols-4">
          {NAV.map((item) => (
            <li key={item.to}>
              <BottomLink {...item} active={pathname === item.to} />
            </li>
          ))}
        </ul>
        {/* Keeps the last tab clear of the iOS home indicator. */}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>
    </div>
  )
}

/**
 * One sidebar item. The active state is a filled pill *and* a weight change on
 * the label, so it survives a greyscale screenshot.
 */
function SidebarLink({
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
        'relative flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2',
        'text-sm transition-colors duration-150',
        active ? 'text-ink font-medium' : 'text-ink-muted hover:text-ink',
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-indicator"
          className="absolute inset-0 -z-10 rounded-[var(--radius-md)]
            bg-[var(--color-paper-sunk)] shadow-[var(--shadow-deboss)]"
          transition={{ type: 'spring', stiffness: 400, damping: 34 }}
        />
      )}
      <Icon size={17} aria-hidden />
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
        'flex flex-col items-center justify-center gap-1 h-[4.25rem] relative',
        'pb-1',
        // 11px was tracking as cramped and slightly misaligned against the
        // icons — it is a label, not a caption, and it sits under a 20px glyph.
        'text-[12px] leading-none tracking-[0.005em]',
        'transition-[color] duration-150',
        active ? 'text-terracotta-ink' : 'text-ink-muted',
      )}
    >
      {/*
       * The indicator slides between tabs rather than blinking on and off.
       *
       * `layoutId` hands the same element to whichever tab is active, so
       * motion interpolates its position and width across the gap instead of
       * one tab's bar fading out while another fades in. That continuity is
       * most of what makes a bottom bar feel like one object rather than four.
       *
       * It is also still a *shape* change, not only a colour change, so the
       * active tab survives a greyscale screenshot and colour-blind vision.
       */}
      <span aria-hidden className="h-[3px] w-7 rounded-full flex items-center">
        {active && (
          <motion.span
            layoutId="bottom-nav-indicator"
            className="h-[3px] w-7 rounded-full"
            style={{ background: 'var(--color-terracotta)' }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          />
        )}
      </span>
      <motion.span
        animate={{ scale: active ? 1 : 0.92, y: active ? -1 : 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className="contents"
      >
        <Icon size={21} aria-hidden />
      </motion.span>
      <span className="leading-none">{label}</span>
    </Link>
  )
}

/**
 * A bottom sheet on mobile, a centred dialog on desktop. Springs up from the
 * bottom edge, slightly under-damped so it settles with a little weight.
 *
 * The desktop geometry is the fix for a sheet that spanned the entire viewport:
 * a form is a column of fields, and stretching it edge to edge on a 27" display
 * put a number input in the middle of the screen with the label a foot away.
 * Bounded to a readable measure and centred, it reads as a dialog instead.
 *
 * The panel is a flex column and the *body* scrolls, not the panel. That is
 * what keeps a long form's Save button on screen instead of scrolled away.
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
            className="fixed inset-0 z-40 bg-[rgb(70_45_25/0.32)] backdrop-blur-[3px]"
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
            className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh]
              flex flex-col overflow-hidden
              bg-paper-raised rounded-t-[var(--radius-xl)]
              shadow-[var(--shadow-float)]
              md:inset-y-auto md:right-auto md:left-1/2 md:top-1/2
              md:max-h-[min(88dvh,52rem)]
              md:w-[min(34rem,calc(100vw-4rem))]
              md:rounded-[var(--radius-xl)]
              md:-translate-x-1/2 md:-translate-y-1/2
              md:backdrop-blur-[var(--material-blur)]
              md:bg-[var(--surface-material)]
              md:shadow-[var(--shadow-float),var(--material-edge)]"
          >
            {/* Debossed drag handle. */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <span
                aria-hidden
                className="h-1.5 w-10 rounded-full bg-rule
                  shadow-[var(--shadow-deboss)]"
              />
            </div>
            <div className="flex items-center justify-between px-5 py-2.5 shrink-0">
              <h2 className="font-serif text-xl">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-ink-muted hover:text-ink"
              >
                Close
              </button>
            </div>
            <div className="px-5 pt-2 pb-4 overflow-y-auto flex-1">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
