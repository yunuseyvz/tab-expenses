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
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Link, useRouteContext, useRouterState } from '@tanstack/react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  LayoutGrid,
  List,
  LogOut,
  Scale,
  Settings as SettingsIcon,
} from 'lucide-react'

import { APP_NAME } from '#/lib/app-meta'
import { Avatar } from '#/components/Avatar'
import { SpaceSwitcher } from '#/components/SpaceSwitcher'
import { TabLogo } from '#/components/TabLogo'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'
import { authClient } from '#/lib/auth-client'
import { cn } from '#/lib/cn'

/**
 * The space this document last painted, or null if it has not painted one.
 *
 * The blur belongs to changing *household*, not to moving between screens. That
 * distinction is awkward to express here because each route renders its own
 * `<AppShell>`, so navigating between sections replaces the component: any
 * per-instance state resets on arrival, and the entrance re-fires on every
 * section change whether it is keyed on the space or not. A latch in the
 * component cannot tell "a new screen mounted" from "a new household mounted".
 *
 * Module scope can. Remembering the space across remounts means the question is
 * answerable: animate only when the space is genuinely not the one already on
 * screen. Same household, new screen, no animation. Different household,
 * animation. First paint, none — which also keeps the server markup and the
 * first client render identical.
 *
 * Lives and dies with the page, so a reload starts over.
 */
let paintedSpace: string | null = null

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
  const { spaceId } = useCurrentSpace()
  const reduceMotion = useReducedMotion()

  // Only animate the swap once the app has settled, never on the first paint.
  // `initial` is read when the keyed element mounts, so starting from `false`
  // means a plain page load renders straight to full opacity — a fade on every
  // load reads as lag — while a later change of space gets the entrance.
  // Written to directly rather than through state: will-change is a compositor
  // hint, and re-rendering the whole shell twice per transition to toggle it
  // would cost more than the hint is worth.
  const contentRef = useRef<HTMLDivElement>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  // Whether the content is about to resolve out of a blur. Read during render so
  // the very first paint gets `initial={false}` and hydration has nothing to
  // reconcile; the latch is updated after, in an effect, because updating it
  // during render would make every later render look like a household change.
  const currentSpace = spaceId ?? 'none'
  const changingHousehold =
    paintedSpace !== null && paintedSpace !== currentSpace
  useEffect(() => {
    paintedSpace = currentSpace
  }, [currentSpace])

  // The protected layout already resolved the session for the route guard, so
  // the account avatar costs nothing extra — it is read from context rather
  // than from a second round trip.
  const { user } = useRouteContext({ from: '/_protected' })

  useEffect(() => {
    if (!accountOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setAccountOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAccountOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [accountOpen])

  async function signOut() {
    setSigningOut(true)
    await authClient.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[auto_1fr]">
      {/* ── desktop: floating sidebar ──────────────────────────────────── */}
      <aside className="hidden md:block">
        {/* z-30, and it has to be here rather than on the popovers themselves.
            The sidebar's panel is `backdrop-filter`ed, which makes it a stacking
            context, so a `z-50` menu inside it is only ever compared against its
            siblings — not against the page beside it. The switcher's menu is
            wider than the sidebar and overhangs into the content column, where
            `main` painted over it and swallowed clicks on the row's own edit
            button. Raising the container puts the whole sidebar above the page;
            the sheets are z-40/z-50, so they still cover it. */}
        <div
          className="sticky top-0 z-30 flex h-dvh flex-col gap-1 p-4
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
              className="px-2.5 pt-2 pb-3.5 text-lg"
            >
              <TabLogo wordmark={APP_NAME} markSize={22} />
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

            {/* The account, with its avatar, at the bottom. Signing out is not a
                peer of going to Balances, so it lives down here rather than in
                the nav. */}
            <div className="mt-auto pt-3 border-t border-rule/70">
              <div className="flex items-center gap-2.5 px-2.5 pb-2">
                <Avatar
                  avatarKey={user.avatar}
                  seed={user.id}
                  name={user.name}
                  size={30}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {user.name}
                  </span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    {user.email}
                  </span>
                </span>
              </div>
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

      {/* No top bar on a phone, and none is needed.
       *
       * It used to hold the mark, the space switcher and the account on every
       * screen: two controls that never change, in a 48px strip of chrome,
       * above content that does. The space switcher moved into the floating
       * bar — where the desktop sidebar keeps it too — and the account moved
       * to the top of Settings, next to the name and theme that belong with
       * it. The greeting on the dashboard is now the first thing on a phone's
       * page, which is a better use of that space than a wordmark.
       *
       * Consequence: content starts at the top of the page, so the main
       * wrapper no longer carries the pt-14 this bar used to occupy.
       */}

      {/*
       * Arriving somewhere: the content resolves out of a blur.
       *
       * KEYED ON PATHNAME *AND* SPACE, WHICH IS THE WHOLE POINT
       * It used to be keyed on the space alone, so the entrance replayed when
       * you changed household and did nothing at all when you moved between
       * the four sections — the one transition a person actually makes dozens
       * of times a day was the one with no animation. Both are now in the key,
       * and neither is in it by accident: the *pathname* rather than the whole
       * search string, so changing the period or a category filter does not
       * blur the list you are looking at in order to change what is in it.
       *
       * IT IS A BLUR FADE IN, NOT A CROSS-FADE
       * Blurring the outgoing content first would mean holding the new
       * screen's numbers on screen until the old ones had finished fading, and
       * paying for two filters instead of one. The swap is instant; only the
       * arrival is animated.
       *
       * THIS BREAKS THE APP'S OWN RULE, ON PURPOSE
       * The stylesheet says to animate transform and opacity only, because
       * filter is not compositor-accelerated and stutters on mid-range Android.
       * That is true and it is why the radius is small, the duration short, and
       * `will-change` is attached only for the length of the animation rather
       * than left on. A permanent will-change: filter holds a full-page
       * rasterised layer for the life of the session, which on the phone this
       * app is used on is worse than the transition it buys.
       *
       * Reduced motion gets a plain cross-fade with no blur and no travel, and
       * the first paint gets nothing at all, so the server markup and the first
       * client render stay identical.
       */}
      <motion.div
        ref={contentRef}
        // Keyed on the space alone, deliberately. See paintedSpace above: the
        // guard is what keeps a section change still, so widening the key to
        // include the pathname would put the same screen's arrival back into
        // the animation.
        key={spaceId ?? 'none'}
        initial={
          changingHousehold
            ? {
                opacity: 0,
                filter: reduceMotion ? 'blur(0px)' : 'blur(7px)',
              }
            : false
        }
        animate={{ opacity: 1, filter: 'blur(0px)' }}
        transition={{
          duration: reduceMotion ? 0.14 : 0.45,
          ease: [0.22, 1, 0.36, 1],
        }}
        onAnimationStart={() => {
          if (!reduceMotion) {
            contentRef.current?.style.setProperty(
              'will-change',
              'filter, opacity',
            )
          }
        }}
        onAnimationComplete={() => {
          contentRef.current?.style.removeProperty('will-change')
        }}
        className="flex-1 min-w-0 pb-24 md:pb-0"
      >
        {children}
      </motion.div>

      {/* ── mobile: the floating bar ───────────────────────────────────
       * The desktop sidebar, sideways: which household you are in, then
       * the four screens. The space switcher leads because it leads in the
       * sidebar, and a hairline separates it for the same reason the sidebar
       * has a rule above its nav — they are different kinds of thing, and
       * running them together is what makes a bottom bar feel like a row of
       * unrelated icons.
       *
       * Detached from the bottom edge rather than pinned to it, which is the
       * whole point: a bar welded to the bezel is a bar the content has to
       * be padded away from, and a bar floating in the middle of the screen
       * is a loose object that casts a shadow and takes its own space.
       */}
      {/* NOT aria-hidden. An earlier version put it on this wrapper, to hide the
          decorative scrim, and that hid the entire primary navigation from the
          accessibility tree along with it — the <nav> landmark and the space
          menu both live inside here. It failed silently: the bar still rendered
          and still looked right, and nothing complained until a test asked for a
          button by role and could not find a button that was plainly on screen.
          The scrim is the only decorative thing here, so that is what carries
          the attribute. */}
      <div
        className="md:hidden fixed inset-x-0 bottom-0 z-30 pointer-events-none
          pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {/* The scroll edge effect. Content dissolves into the paper as it passes
            under the glass, so the bar's top rim is a gradient rather than a
            cut. Sits behind the bar, and is the only reason a translucent bar
            over a scrolling list stays readable. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[var(--glass-scrim)]"
        />

        <nav
          aria-label="Main"
          className="pointer-events-auto mx-3 flex items-stretch gap-1
            rounded-full border border-rule/60
            bg-[var(--glass-surface)]
            backdrop-blur-[var(--glass-blur)]
            backdrop-saturate-[var(--glass-saturate)]
            shadow-[var(--glass-edge),var(--glass-shadow)]
            px-1.5 py-[0.45rem]"
        >
          <SpaceSwitcher variant="avatar" menuSide="above" />

          <span aria-hidden className="w-px self-stretch my-1.5 bg-rule/70" />

          <ul className="flex flex-1 items-stretch">
            {NAV.map((item) => (
              <li key={item.to} className="flex-1">
                <BottomLink {...item} active={pathname === item.to} />
              </li>
            ))}
          </ul>
        </nav>
      </div>
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
      className="relative flex flex-col items-center justify-center gap-0.5
        rounded-full px-1.5 pt-1.5 pb-1 min-w-0
        transition-colors duration-200
        active:scale-[0.94] motion-reduce:active:scale-100"
    >
      {/*
       * A tinted pill behind the active tab, sliding between them.
       *
       * `layoutId` hands the same element to whichever tab is active, so motion
       * interpolates its position and width across the gap instead of one tab's
       * pill vanishing while another appears. That continuity is most of what
       * makes a bar feel like one object rather than four.
       *
       * This replaced a 3px rule above the icon, which is how a tab bar looked
       * before the material arrived. A tinted capsule is the newer idiom, and
       * Apple's guidance is to tint selectively — the one thing that is
       * selected — rather than tint the bar as a whole.
       *
       * It is a *shape* change as well as a colour one, so the active tab
       * survives a greyscale screenshot and colour-blind vision.
       */}
      {active && (
        <motion.span
          layoutId="bottom-nav-pill"
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'color-mix(in oklab, var(--color-terracotta) 14%, transparent)',
          }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}

      <motion.span
        animate={{ scale: active ? 1 : 0.94 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className="relative"
      >
        <Icon
          size={21}
          aria-hidden
          className={active ? 'text-terracotta-ink' : 'text-ink-muted'}
        />
      </motion.span>

      <span
        className={cn(
          // 11px. 11.5 was chosen against a 20px glyph and reads as a caption
          // beside these icons; at four across a 390px screen the labels are the
          // widest thing in the bar and were setting the rhythm of it.
          'relative block text-[11px] leading-none tracking-[0.01em] truncate',
          active ? 'text-terracotta-ink' : 'text-ink-muted',
        )}
      >
        {label}
      </span>
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
 * The panel is a flex column and the *body* scrolls, not the panel. That is what
 * keeps a long form's Save button on screen instead of scrolled away.
 *
 * Rendered into `document.body` through a portal, and that is not incidental.
 * Every piece of chrome in this app has a `backdrop-filter` on it — the top
 * bar, both navs, the sidebar — and a filtered, blurred or transformed ancestor
 * becomes the containing block for `position: fixed` descendants. So a sheet
 * rendered inside the top bar positioned itself against that 48px strip instead
 * of the viewport, and opened out of bounds above the screen. Portalling is the
 * only reliable fix; escaping it with a higher z-index does nothing, because the
 * problem is where the box is measured, not what is painted over it.
 *
 * `variant="dialog"` is for a confirmation raised from *inside* an open sheet.
 * Two stacked bottom sheets on a phone read as one tall card with two drag
 * handles and two Cancel buttons — the screenshot that prompted this — so the
 * nested one is always centred and paints above its parent (z-[70] over the
 * parent's z-50). `hideBackdrop` on the parent drops the parent's dimming layer
 * while the nested dialog is up: one dim, not two, and no second dim to click
 * through.
 */
export function Sheet({
  open,
  onClose,
  title,
  headerAction,
  variant = 'sheet',
  hideBackdrop = false,
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  /** Optional control at the top-right, beside the title — a lock toggle. */
  headerAction?: React.ReactNode
  /** `dialog` = always centred, above any open sheet. For nested confirms. */
  variant?: 'sheet' | 'dialog'
  /** Drop the dimming layer — when a nested dialog is up, its dim replaces it. */
  hideBackdrop?: boolean
  /**
   * Pinned action bar below the scroll area — Save/Cancel, Close, and the
   * like. A SIBLING of the scrollable body, not a sticky child of it, and
   * that is load-bearing: a sticky footer inside the scroller shares the
   * scroller's box, so a classic scrollbar takes its width out of the footer
   * and the buttons shift whenever the content grows long enough to scroll.
   * Outside it, the bar never moves and never resizes.
   *
   * It is outside any `<form>` the body may hold, so a submit button in here
   * reaches its form through the `form` attribute rather than ancestry.
   */
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  // document does not exist during SSR. `open` is false on the server, so this
  // is belt-and-braces, but a portal that throws on first paint is a nasty way
  // to find out.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Escape closes it. This was assumed to be true for as long as the sheet had a
  // Close button in its header, so nobody checked: there was no listener, and the
  // header button covered for it. Removing the button left the keyboard with no
  // way out of a dialog, which is the one thing a dialog must not do.
  //
  // It matters most for the sheets that have no footer button of their own. A
  // sheet opened to invite someone has nothing but the backdrop to click.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const panel = (
    <AnimatePresence>
      {open && (
        <>
          {!hideBackdrop && (
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
          )}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            // Both variants used to spring up from the bottom edge, and that
            // was right for a sheet arriving on its own. It is wrong for a
            // dialog arriving on top of one: the box rose past the frame's top
            // and then back down, so the first thing on screen was the bottom
            // half of a confirmation sliding over the header of the form it was
            // asking about. A dialog has no direction to arrive from, so it
            // fades and scales from just-below-full — the same spring, aimed at
            // the panel's own size instead of the viewport's.
            initial={
              variant === 'dialog' ? { opacity: 0, scale: 0.96 } : { y: '100%' }
            }
            animate={variant === 'dialog' ? { opacity: 1, scale: 1 } : { y: 0 }}
            exit={
              variant === 'dialog' ? { opacity: 0, scale: 0.96 } : { y: '100%' }
            }
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className={cn(
              'flex flex-col overflow-hidden',
              variant === 'dialog'
                ? [
                    // Above any sheet, no drag handle: this is a dialog, not
                    // something you flick away. The material fill, blur and edge
                    // shadow are the desktop sheet's, so a nested dialog is not
                    // a flatter object than the sheet it sits on.
                    //
                    // Anchored near the top of a phone rather than centred in
                    // it. A centred box over a full-height bottom sheet leaves
                    // the form's header above it and its footer below, so the
                    // two read as one broken sheet with a seam across the middle.
                    // At the top, with the sheet behind dimmed, it reads as a
                    // dialog raised over a page.
                    'fixed inset-x-4 top-16 z-[70] h-fit mx-auto',
                    'max-h-[min(70dvh,40rem)]',
                    'w-[min(30rem,calc(100vw-2rem))]',
                    // Desktop gets the sheet's own centring, because there is
                    // no sheet underneath it to be confused with.
                    'md:inset-x-auto md:top-1/2 md:max-h-[min(88dvh,52rem)]',
                    'md:-translate-x-1/2 md:-translate-y-1/2',
                    'rounded-[var(--radius-xl)]',
                    'bg-[var(--surface-material)]',
                    'backdrop-blur-[var(--material-blur)]',
                    'shadow-[var(--shadow-float),var(--material-edge)]',
                  ]
                : [
                    'fixed inset-x-0 bottom-0 z-50 max-h-[88dvh]',
                    // Opaque paper on a phone — a sheet that starts half-way
                    // down the screen must not be a window onto the list
                    // beneath it. The material treatment arrives at desktop
                    // width with the centred geometry, as it always has.
                    'bg-paper-raised rounded-t-[var(--radius-xl)]',
                    'shadow-[var(--shadow-float)]',
                    'md:inset-y-auto md:right-auto md:left-1/2 md:top-1/2',
                    'md:max-h-[min(88dvh,52rem)]',
                    'md:w-[min(34rem,calc(100vw-4rem))]',
                    'md:-translate-x-1/2 md:-translate-y-1/2',
                    'md:rounded-[var(--radius-xl)]',
                    'md:backdrop-blur-[var(--material-blur)]',
                    'md:bg-[var(--surface-material)]',
                    'md:shadow-[var(--shadow-float),var(--material-edge)]',
                  ],
            )}
          >
            {/* Debossed drag handle. Bottom sheets only — a centred dialog that
                could be flicked away would be a sheet again. */}
            {variant === 'sheet' && (
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <span
                  aria-hidden
                  className="h-1.5 w-10 rounded-full bg-rule
                    shadow-[var(--shadow-deboss)]"
                />
              </div>
            )}
            {/* No close control in the header.
             *
             * Every sheet already has three: a Cancel button in its footer, the
             * backdrop, and Escape. This one was a fourth, in the least useful
             * position, and it was the only one of the four that did nothing on
             * mobile, where a header Close is nowhere near the Cancel people use.
             *
             * Removing it leaves the title alone in the bar, which is where a
             * title belongs anyway. The drag handle is what says "this is
             * dismissible" on a phone, and the backdrop says it everywhere else.
             */}
            <div
              className={cn(
                'px-5 shrink-0 flex items-center gap-3',
                // A dialog has no handle to breathe under.
                variant === 'sheet' ? 'py-2.5' : 'pt-5 pb-2',
              )}
            >
              <h2 className="text-xl tracking-tight flex-1 min-w-0 truncate">
                {title}
              </h2>
              {headerAction}
            </div>
            {/* No bottom padding here. The footer below is a sibling of this
                box rather than a sticky child of it, so it never scrolls and
                a scrollbar never takes its width out of the buttons. */}
            <div className="px-5 pt-2 overflow-y-auto flex-1">{children}</div>
            {footer && <div className="shrink-0">{footer}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  if (!mounted) return null
  return createPortal(panel, document.body)
}
