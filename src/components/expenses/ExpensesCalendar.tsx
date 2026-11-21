import { useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import type { CalendarCell } from '#/lib/calendar'
import type { DayTotal } from '#/lib/expense.functions'
import {
  WEEKDAYS,
  WEEKDAYS_LONG,
  fromISODate,
  longDate,
  monthGrid,
  monthLabel,
  toISODate,
} from '#/lib/calendar'
import { formatMoney } from '#/lib/money'
import { cn } from '#/lib/cn'

/**
 * The calendar grid: one month of the ledger, as days.
 *
 * A RENDERING of the filter, not a second filter: the month on show is
 * derived from the period (see `periodMonth`), the per-day figures are the
 * `dayTotals` the ledger query already returns, and flipping a month is a
 * period change the route navigates to — so the grid, the pills above it and
 * the URL can never disagree about which window is on screen.
 *
 * Selection is passed in and out rather than held here: a chosen day is part
 * of the screen's state, so it lives in the URL with everything else, and this
 * component stays drawable from props alone.
 */
export function ExpensesCalendar({
  month,
  onMonthChange,
  dayTotals,
  monthTotalMinor,
  pending,
  currency,
  selectedDay,
  onSelectDay,
}: {
  /** Any day in the month to show; the route derives it from the period. */
  month: Date
  /** Steps the shown month, by navigating the period (see the note above). */
  onMonthChange: (delta: 1 | -1) => void
  /** Per-day figures over the WHOLE filter, from the ledger query. Unpaged. */
  dayTotals: ReadonlyArray<DayTotal>
  /** The shown month's total, over the same figures the cells read. */
  monthTotalMinor: number
  /** True only while the first load has not answered; flips keep the old data. */
  pending: boolean
  currency: string
  /** The URL's chosen day, or null. Tapping the chosen day clears it. */
  selectedDay: string | null
  onSelectDay: (iso: string | null) => void
}) {
  const cells = useMemo(() => monthGrid(month), [month])
  const totals = useMemo(
    () => new Map(dayTotals.map((d) => [d.spentOn, d])),
    [dayTotals],
  )

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
        <div className="flex flex-col items-center" aria-live="polite">
          <span className="text-sm font-medium">{monthLabel(month)}</span>
          {/* The month's own figure, under its name — each pane on this screen
              carries its own number, so the header's count stays the
              statement's and the two never describe each other's content. */}
          {!pending && (
            <span className="text-xs tnum text-ink-faint">
              {formatMoney(monthTotalMinor, currency)}
            </span>
          )}
        </div>
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
        className="grid grid-cols-7 gap-0.5"
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
              // Tapping the chosen day again clears it, like a disclosure.
              onClick={() => onSelectDay(selected ? null : cell.iso)}
              onKeyDown={(e) => onCellKeyDown(cell.iso, e)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 p-1 min-h-14',
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
    </div>
  )
}
