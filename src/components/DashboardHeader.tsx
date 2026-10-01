import { useEffect, useState } from 'react'

import { Avatar } from '#/components/Avatar'
import { greeting } from '#/lib/greeting'
import { NewExpenseButton } from '#/components/NewExpenseButton'
import { TabLogo } from '#/components/TabLogo'
import { APP_NAME } from '#/lib/app-meta'
import { cn } from '#/lib/cn'

/**
 * The dashboard header: who you are, whose money this is, and the month so far.
 *
 * It exists because the mobile top bar is gone. That bar carried the mark and
 * the account on every screen, which is a poor use of the most valuable space
 * on a phone — two controls that never change, sitting above content that does.
 * Now the greeting, the household and the running totals have the top of the
 * screen to themselves, on every device.
 *
 * THE IDENTITY IS HERE, NOT IN A BAR
 * The mark and wordmark used to be a 48px strip of chrome. This is the one screen
 * where the app is *about* something — a household's month, summarised — so it
 * is the right place for the app to introduce itself. On a phone this greeting
 * is the first thing on the page, and a page whose first line is a bare number
 * has no idea what it is showing you.
 */
export function DashboardHeader({
  user,
  spaceName,
  currency,
  periodLabel,
  onNewExpense,
  newDisabled,
  className,
}: {
  user: { id: string; name: string; email: string; avatar?: string | null }
  spaceName?: string
  currency?: string
  /** Resolved by the caller, so this and the filter below cannot disagree. */
  periodLabel: string
  onNewExpense: () => void
  newDisabled?: boolean
  className?: string
}) {
  return (
    <header className={cn('mb-5', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* The app's mark, then the reader's — so one line answers "whose app
              is this, and whose data is in it", which is the question a shared
              device has to answer before anything else. */}
          <div className="flex items-center gap-2.5 mb-3">
            <TabLogo markSize={26} wordmark={APP_NAME} />
            <span aria-hidden className="w-px h-5 bg-rule" />
            <Avatar
              avatarKey={user.avatar}
              seed={user.id}
              name={user.name}
              size={22}
            />
          </div>

          {/* The greeting is a paragraph and the household is the heading, which
              is the reverse of what looks natural. A greeting is a courtesy; the
              household's name is what this page *is*. Making the courtesy the
              h1 leaves the page with no heading of its own, and the greeting
              changing four times a day means the document's top-level structure
              changes four times a day too. */}
          <p className="mt-3 text-2xl sm:text-3xl tracking-tight">
            <Salutation name={user.name} />
          </p>

          <h1 className="mt-1 text-base sm:text-lg font-medium tracking-tight">
            {spaceName ?? 'Dashboard'}
          </h1>
          <p className="text-xs text-ink-faint tnum mt-0.5">
            {currency ?? '—'} · {periodLabel}
          </p>
        </div>

        <NewExpenseButton
          onClick={onNewExpense}
          disabled={newDisabled}
          className="shrink-0"
        />
      </div>
    </header>
  )
}

/**
 * The greeting, read from the reader's clock after mount.
 *
 * Null until then, and rendering a neutral placeholder in the meantime. A
 * server-rendered greeting would be stamped from the *server's* clock: "Good
 * morning" would arrive in the afternoon for anyone east of the host, and would
 * not change for the rest of the day. The cost of doing it here is one frame
 * with a word missing, which is far cheaper than being wrong for twelve hours.
 */
function Salutation({ name }: { name: string }) {
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    setText(greeting(name))
  }, [name])

  if (text === null) {
    // Same element, same length class: the server markup and the first client
    // render are identical, so hydration has nothing to reconcile.
    return <span className="text-ink-faint">Hello</span>
  }
  return <>{text}</>
}
