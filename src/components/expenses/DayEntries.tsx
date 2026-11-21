import type { ExpenseRow } from '#/lib/expense.functions'
import { Card } from '#/components/ui/Card'
import { LedgerRow } from '#/components/expenses/LedgerRow'
import { longDate } from '#/lib/calendar'
import { formatMoney } from '#/lib/money'

/**
 * One day's entries, as a statement section.
 *
 * Rendered wherever the reader is looking at a day: under the grid on a
 * phone's calendar view, or in the statement pane beside it on a desktop. The
 * same component both places, because it is the same answer — a day panel that
 * looked or behaved differently between the two would be two things to learn
 * where one would do.
 *
 * The header carries the day's own figure and the way back to the period, so
 * the pane is never a dead end: a filtered view you cannot leave reads as a
 * filter you cannot turn off.
 */
export function DayEntries({
  day,
  rows,
  totalMinor,
  pending,
  currency,
  onOpenRow,
  onClear,
}: {
  /** ISO `YYYY-MM-DD`. */
  day: string
  rows: ReadonlyArray<ExpenseRow>
  /** The day's total over the same filter, when the answer has any. */
  totalMinor: number | undefined
  pending: boolean
  currency: string
  onOpenRow: (row: ExpenseRow) => void
  /** Back to the whole period — the statement pane's ordinary content. */
  onClear: () => void
}) {
  return (
    <section aria-label={`Entries on ${longDate(day)}`}>
      {/* Sticky date header, like the statement it stands in for. */}
      <div className="sticky top-0 z-10 py-1.5 bg-paper/90 backdrop-blur-sm">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold truncate">{longDate(day)}</h2>
          <span className="flex items-baseline gap-3 shrink-0">
            {totalMinor !== undefined && (
              <span className="tnum text-sm text-ink-muted">
                {formatMoney(totalMinor, currency)}
              </span>
            )}
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-ink-muted underline underline-offset-4
                transition-colors duration-150 hover:text-ink"
            >
              Show the whole period
            </button>
          </span>
        </div>
      </div>

      <Card className="p-0">
        {pending ? (
          <p className="px-4 py-3 text-sm text-ink-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-muted">
            Nothing here for this filter.
          </p>
        ) : (
          rows.map((e) => (
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
  )
}
