/**
 * The settings screen's shape: labelled groups, rows in one card, drill-down for
 * anything with a list behind it.
 *
 * It was seven separate cards stacked in whatever order they happened to be
 * written, which is not how an operating system presents settings and not how
 * anyone reads them either. The model here is the one macOS and iOS Settings
 * both use, for reasons that are worth stating because they are not cosmetic:
 *
 * A GROUP HEADER says whose settings these are. Account, Household, Data. Once
 * you know which group a thing belongs to you stop scanning for it, which is the
 * entire job.
 *
 * ONE CARD PER GROUP with hairlines between rows, not a card per row. Separate
 * cards for separate things reads as separate things; a single card with rules
 * reads as one list, and a list can be scanned in a way a column of boxes
 * cannot.
 *
 * A ROW'S VALUE sits on the right, where an eye lands last. The label is what
 * you are looking for; the value is the answer. Putting "3 members" under the
 * word "Members" makes you read it twice.
 *
 * AND ANYTHING WITH A LIST BEHIND IT DRILLS DOWN. Members is not "3" on a
 * settings page, it is a page of three people with colours and shares, and the
 * form for adding a fourth has no business being under a heading on a different
 * screen. So Members, Categories, Invites, Import and Export are rows, and each
 * is a page of its own with a way back.
 *
 * The indentation the OS uses to mean "this is a sub-page" is deliberately not
 * reproduced: a chevron already says it, and a chevron is one fewer thing to
 * read.
 */
import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '#/lib/cn'

/**
 * The card: one list, hairlines between rows.
 *
 * `p-0`, because the rows inside bring their own padding and a card that also
 * padded would double every edge.
 *
 * The rules are on the children rather than on the rows themselves: `[&>*+*]`
 * matches every child but the first, so the list gets a rule between its rows and
 * none under the last one. A `border-b` with `last:border-b-0` on each row says
 * the same thing in three places instead of one, and this way a row added to a
 * card cannot forget it.
 */
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="card overflow-hidden [&>*+*]:border-t [&>*+*]:border-rule">
      {children}
    </div>
  )
}

/**
 * A top-level section: the answer to "whose settings are these".
 *
 * There are two levels on this screen and they have to be told apart at a
 * glance, or the structure is only in the markup. A SECTION is a subject —
 * Household, App settings, Account — and it is sentence case and ink-coloured,
 * one step under the page title. A GROUP inside it is a list within that subject
 * — Members, Categories, Data — and it is the small caps, muted, unreadable-if-
 * you-are-not-looking treatment the rest of the screen uses for labels.
 *
 * That difference is the whole reason the members, categories and data lists can
 * sit under one Household heading without becoming one undifferentiated column of
 * cards: the size says which layer you are reading before the words do.
 *
 * Sections are separated by space rather than a rule. A rule between sections
 * would compete with the rules inside the cards, and there would then be two
 * kinds of line on the screen meaning two different things.
 */
export function SettingsSection({
  title,
  hint,
  children,
}: {
  title: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-9 first:mt-0">
      <h2 className="px-1 text-lg font-medium tracking-tight text-ink">
        {title}
      </h2>
      {hint && (
        // Smaller than the group headings it would otherwise outrank. At text-sm
        // the household's own name sat above "Members" in a larger typeface,
        // which read as though the group were inside the sentence rather than
        // the other way round. ink-muted rather than ink-faint keeps it as the
        // section's subtitle without competing with the label beneath it.
        <p className="px-1 mt-1 text-xs leading-relaxed text-ink-muted">
          {hint}
        </p>
      )}
      <div className="mt-4 space-y-6">{children}</div>
    </section>
  )
}

/**
 * One labelled group: a heading, an optional line of context, and a card of
 * rows.
 *
 * The title is optional, and a group without one is a bare card. That is what a
 * section holding a single unlabelled list wants — "App settings" with a
 * heading, a "Appearance" sub-heading and one row underneath would be three
 * labels for one control.
 *
 * `hint` is a sentence, not a caption fragment. It exists to say what the group
 * is *for* when the heading alone is ambiguous, and it is the only place in this
 * screen that gets to explain itself.
 */
export function SettingsGroup({
  title,
  hint,
  children,
  className,
}: {
  title?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn(className)}>
      {title && (
        /*
         * The heading and its hint share one bottom margin, so the gap between
         * the block and the card is the same whether or not there is a hint.
         *
         * It was on the hint alone, which meant a group without one got no gap
         * at all and sat flush against its own card, while every group with a
         * hint looked correct. The margin belongs to the block, not to the
         * sentence that happens to be in it.
         */
        <div className="px-1 mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
            {title}
          </h3>
          {hint && (
            <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
              {hint}
            </p>
          )}
        </div>
      )}
      <SettingsCard>{children}</SettingsCard>
    </section>
  )
}

/**
 * A row in a group.
 *
 * Renders as a `Link` when given `to`, which is what makes the whole row the
 * target rather than a chevron-sized piece of it. `value` is the right-hand
 * answer; `children` replaces it, for a row that holds a control instead.
 */
export function SettingsRow({
  label,
  hint,
  value,
  icon: Icon,
  to,
  search,
  onClick,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  /** Right-hand summary text. Ignored when `children` is given. */
  value?: ReactNode
  /**
   * A leading mark, in the same slot the roster uses.
   *
   * Same slot rather than a bare glyph because a row's left edge is a column:
   * every label starts at the same x, and that is what makes a list scannable.
   * A 16px icon floating in front of an indent does not line up with a 28px
   * category chip beside it, and the eye reads the stagger as a mistake.
   */
  icon?: LucideIcon
  /** Route *path* only. Query goes in `search`, never in here. */
  to?: string
  search?: Record<string, unknown>
  /**
   * Opens a sheet or starts a download, in place. For a row whose result is not
   * a different page: an importer and a download have nothing to navigate back
   * from, so giving them a URL would be a route that exists only to be left.
   */
  onClick?: () => void
  children?: ReactNode
  className?: string
}) {
  const inner = (
    <>
      {Icon && (
        // size-7 and rounded-[7px] to match the category chips, at a 15px glyph
        // to match the glyph inside them.
        <span
          aria-hidden
          className="grid place-items-center size-7 shrink-0 rounded-[7px]
            bg-[var(--color-paper-sunk)] text-ink-muted"
        >
          <Icon size={15} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm truncate">{label}</span>
        {hint && (
          <span className="block text-xs text-ink-faint mt-0.5 leading-snug">
            {hint}
          </span>
        )}
      </span>
      {children ?? (
        <>
          {value !== undefined && (
            <span className="shrink-0 text-sm text-ink-muted tnum truncate max-w-[45%]">
              {value}
            </span>
          )}
          {/* A tappable row says so. `to` rows always had one; `onClick` rows
              did not, so the profile row — avatar, name, address — read as a
              status line rather than as the way to change any of it. */}
          {(to || onClick) && (
            <ChevronRight
              size={16}
              aria-hidden
              className="shrink-0 text-ink-faint"
            />
          )}
        </>
      )}
    </>
  )

  const rowClass = cn(
    'flex w-full items-center gap-3 px-4 py-3 text-left',
    'transition-colors duration-150',
    className,
  )

  if (to) {
    return (
      <Link
        to={to}
        // `search` as its own prop, because `to` is a *path*. Passing
        // `?space=…` inside `to` does not produce a query string: the router
        // reads the whole thing as the pathname, then appends the search it
        // inherited from the current location, giving
        // `/settings/members?space=X?period=all`. Two question marks, no route
        // match, and a row that looks dead.
        search={search}
        className={cn(rowClass, 'hover:bg-[var(--color-paper-sunk)]')}
      >
        {inner}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(rowClass, 'hover:bg-[var(--color-paper-sunk)]')}
      >
        {inner}
      </button>
    )
  }
  return <div className={rowClass}>{inner}</div>
}

/**
 * The header for a sub-page: a way back, and the name of what you are looking
 * at.
 *
 * The back control is a real link, not a `history.back()`. A sub-page reached by
 * tapping a row should be left the same way, and `history.back()` from a page
 * opened in a new tab, or after a hard refresh, has nowhere to go.
 */
export function SettingsSubpage({
  title,
  hint,
  children,
  backTo = '/settings',
  backSearch,
}: {
  title: string
  hint?: ReactNode
  children: ReactNode
  /** Path only. The `space` to come back to goes in `backSearch`. */
  backTo?: string
  /** Which household to return to, so back does not drop you somewhere else. */
  backSearch?: Record<string, unknown>
}) {
  return (
    // A <main>, not a div. Every other screen in the app has one, the skip link
    // points at `#main`, and a sub-page without it means "Skip to content" lands
    // nowhere. It is also what makes these pages findable by landmark.
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
      <Link
        to={backTo}
        search={backSearch}
        className="inline-flex items-center gap-1 text-sm text-ink-muted
          hover:text-ink mb-3 -ml-1 px-1 py-0.5 rounded-[var(--radius-sm)]
          transition-colors duration-150"
      >
        <ChevronLeft size={16} aria-hidden />
        Settings
      </Link>
      <h1 className="text-2xl sm:text-3xl tracking-tight">{title}</h1>
      {hint && (
        <p className="mt-1 text-sm text-ink-muted max-w-prose leading-relaxed">
          {hint}
        </p>
      )}
      <div className={hint ? 'mt-5' : 'mt-4'}>{children}</div>
    </main>
  )
}
