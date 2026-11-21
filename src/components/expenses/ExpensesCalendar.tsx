import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import type { CalendarCell } from '#/lib/calendar'
import type { DayTotal, ExpenseRow } from '#/lib/expense.functions'
import type { Period } from '#/lib/period'
import {
  WEEKDAYS,
  WEEKDAYS_LONG,
  fromISODate,
  longDate,
  monthGrid,
  monthLabel,
  toISODate,
} from '#/lib/calendar'
import { Card } from '#/components/ui/Card'
import { LedgerRow } from '#/components/expenses/LedgerRow'
import { expensesQuery } from '#/lib/session'
import { formatMoney } from '#/lib/money'
import { cn } from '#/lib/cn'

/**
 * The expenses screen's calendar view.
 *
 * A RENDERING of the ledger, not a second ledger: the month on show is derived
 * from the period (see `periodMonth`), the per-day figures are the `dayTotals`
 * the list view already loads, and flipping a month is a period change — the
 * route sets a custom month range and the pills above move with it. Calendar
 * and filter can therefore never disagree about which window is on screen, and
 * the URL stays the whole state, shareable like every other view of this app.
 *
 * Tapping a day opens that day under the grid, in the row component the list
 * uses, narrowed to the same period/member/category filter the grid drew — so a
 * blank cell that opens with entries in it cannot happen: the clamp answers the
 * question the filter asked, not a different one.
 */
export function ExpensesCalendar({
  spaceId,
  month,
  onMonthChange,
  period,
  memberId,
  categoryIds,
  dayTotals,
  pending,
  currency,
  onOpenRow,
}: {
  /** The space whose ledger this renders; falsy while the space resolves. */
  spaceId: string | undefined
  /** Any day in the month to show; the route derives it from the period. */
  month: Date
  /** Steps the shown month, by navigating the period (see the note above). */
  onMonthChange: (delta: 1 | -1) => void
  /** The resolved period — the drill-down is this filter narrowed to a day. */
  period: Period
  memberId: string | null
  categoryIds: Array<string> | undefined
  /** Per-day figures over the WHOLE filter, from the ledger query. Unpaged. */
  dayTotals: ReadonlyArray<DayTotal>
  /** True only while the first load has not answered; flips keep the old data. */
  pending: boolean
  currency: string
  onOpenRow: (row: ExpenseRow) => void
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  /*
   * A chosen day belongs to the month it was chosen in. Flipping away puts the
   * panel's subject off-screen, and a card about something you cannot see is a
   * stray card rather than an answer.
   */
  const monthKey = toISODate(month).slice(0, 7)
  useEffect(() => {
    setSelectedDay(null)
  }, [monthKey])

  const cells = useMemo(() => monthGrid(month), [month])
  const totals = useMemo(
    () => new Map(dayTotals.map((d) => [d.spentOn, d])),
    [dayTotals],
  )

  /*
   * The drill-down's bounds are the day INTERSECTED with the period, not the
   * day alone. A day outside the filter yields from > to and matches nothing,
   * which is the same thing its blank cell was saying — so the panel and the
   * grid agree by construction, and with an unbounded period (All, or no dates
   * under Custom) the intersection is simply the day itself.
   */
  const dayFilter = useMemo(() => {
    if (!selectedDay) return null
    return {
      from:
        period.from && period.from > selectedDay ? period.from : selectedDay,
      to: period.to && period.to < selectedDay ? period.to : selectedDay,
      memberId,
      categoryIds,
    }
  }, [selectedDay, period.from, period.to, memberId, categoryIds])

  /*
   * The day's own query, so the month grid above never re-fetches while you
   * inspect a day — the grid keeps its figures and the panel answers its own
   * question. 200 is the server's page ceiling; a single household day past it
   * is not a real case, and the alternative is a pager under a calendar.
   */
  const day = useQuery({
    ...expensesQuery(
      spaceId ?? '',
      dayFilter ?? { from: null, to: null, memberId, categoryIds },
      { limit: 200 },
    ),
    enabled: Boolean(spaceId) && dayFilter !== null,
  })

  const dayRows = day.data?.rows ?? []
  const dayTotal = day.data?.dayTotals.find(
    (t) => t.spentOn === selectedDay,
  )?.totalMinor

  /*
   * Keyboard is a proper grid, like the date field: arrows step by day and
   * week, Home/End jump to the ends of the week. Focus moves between the real
   * buttons rather than being simulated on one element, because every cell here
   * is independently clickable — unlike the date field's grid, where only the
   * highlighted day can be picked.
   */
  const cellRefs = useRef(new Map<string, HTMLButtonElement>())

  function focusCell(iso: string) {
    cellRefs.current.get(iso)?.focus()
  }

  function onCellKeyDown(iso: string, e: React.KeyboardEvent) {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    let delta: number
    if (e.key in step) {
      e.preventDefault()
      delta = step[e.key] as number
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      // Monday of the cursor's own week. The grid is Monday-first, so this is
      // the first cell of its row.
      const dow = (fromISODate(iso).getDay() + 6) % 7
      delta = e.key === 'Home' ? -dow : 6 - dow
    } else {
      return
    }

    const target = fromISODate(iso)
    target.setDate(target.getDate() + delta)
    // The block shows whole weeks, so a step within it always lands on a
    // rendered cell; only off the 42-cell block does the key do nothing, and
    // the month buttons are the way past that edge.
    focusCell(toISODate(target))
  }

  function cellLabel(cell: CalendarCell, d: DayTotal | undefined): string {
    const base = longDate(cell.iso)
    if (!d) return base
    return `${base}, ${formatMoney(d.totalMinor, currency)}, ${
      d.count === 1 ? '1 entry' : `${d.count} entries`
    }`
  }

  return (
    <div>
      {pending && <p className="text-sm text-ink-muted mb-2">Loading…</p>}

      <div className="flex items-center justify-between mb-1.5">
        <button
          type="button"
          onClick={() => onMonthChange(-1)}
          aria-label="Previous month"
          className="grid place-items-center size-7 rounded-full text-ink-muted
            transition-colors duration-150 hover:bg-[var(--color-paper-sunk)]
            hover:text-ink active:scale-95 motion-reduce:active:scale-100"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <span aria-live="polite" className="text-sm font-medium">
          {monthLabel(month)}
        </span>
        <button
          type="button"
          onClick={() => onMonthChange(1)}
          aria-label="Next month"
          className="grid place-items-center size-7 rounded-full text-ink-muted
            transition-colors duration-150 hover:bg-[var(--color-paper-sunk)]
            hover:text-ink active:scale-95 motion-reduce:active:scale-100"
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((d, i) => (
          <abbr
            key={d + i}
            title={WEEKDAYS_LONG[i]}
            className="grid place-items-center h-6 text-[11px] font-semibold
              text-ink-faint no-underline cursor-default"
          >
            {d}
          </abbr>
        ))}
      </div>

      <div
        role="grid"
        aria-label={`${monthLabel(month)} calendar`}
        className="grid grid-cols-7 gap-0.5 sm:gap-1"
      >
        {cells.map((cell) => {
          const d = totals.get(cell.iso)
          const selected = selectedDay === cell.iso
          return (
            <button
              key={cell.iso}
              type="button"
              role="gridcell"
              ref={(el) => {
                if (el) cellRefs.current.set(cell.iso, el)
                else cellRefs.current.delete(cell.iso)
              }}
              aria-selected={selected}
              aria-current={cell.isToday ? 'date' : undefined}
              aria-label={cellLabel(cell, d)}
              // Tapping the chosen day again closes it, like a disclosure.
              onClick={() => setSelectedDay(selected ? null : cell.iso)}
              onKeyDown={(e) => onCellKeyDown(cell.iso, e)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 p-1 min-h-14 sm:min-h-20',
                'text-center rounded-[var(--radius-sm)]',
                'transition-[background-color,color,transform] duration-150',
                'active:scale-95 motion-reduce:active:scale-100',
                // Borrowed days stay clickable — the clamp makes them answer
                // honestly — but dimmed, so the month being read keeps its
                // figure. Same convention as the date field's grid.
                !cell.inMonth && 'opacity-40',
                /*
                 * A day with spend stands proud of the page. In this app's
                 * material language raised means present — so the shape of the
                 * month is legible before a single figure is read, and a blank
                 * cell needs no styling to say "nothing".
                 */
                !selected && d && 'neo',
                // Hover is the affordance for acting on a blank day; a raised
                // one already reads as a thing, and a sunk fill on top of a
                // raised shadow is the one material this look must never mix.
                !selected && !d && 'hover:bg-[var(--color-paper-sunk)]',
                selected &&
                  'bg-[var(--color-terracotta)] text-[var(--color-ink)]',
                // Today when it is not also the selection. An outline rather
                // than a fill, so the two states never fight.
                !selected &&
                  cell.isToday &&
                  'ring-1 ring-inset ring-[var(--color-terracotta)]',
              )}
            >
              <span className="text-sm leading-none">
                {cell.date.getDate()}
              </span>
              {d && (
                <span className="text-[11px] tnum leading-none max-w-full truncate">
                  {formatMoney(d.totalMinor, currency)}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {selectedDay && (
        <section
          aria-label={`Entries on ${longDate(selectedDay)}`}
          className="mt-4"
        >
          {/* Sticky date header, like the statement below it. */}
          <div className="sticky top-0 z-10 py-1.5 bg-paper/90 backdrop-blur-sm">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">{longDate(selectedDay)}</h2>
              {dayTotal !== undefined && (
                <span className="tnum text-sm text-ink-muted">
                  {formatMoney(dayTotal, currency)}
                </span>
              )}
            </div>
          </div>

          <Card className="p-0">
            {day.isPending ? (
              <p className="px-4 py-3 text-sm text-ink-muted">Loading…</p>
            ) : dayRows.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-muted">
                Nothing here for this filter.
              </p>
            ) : (
              dayRows.map((e) => (
                <LedgerRow
                  key={e.id}
                  row={e}
                  currency={currency}
                  onOpen={onOpenRow}
                />
              ))
            )}
          </Card>
        </section>
      )}
    </div>
  )
}
