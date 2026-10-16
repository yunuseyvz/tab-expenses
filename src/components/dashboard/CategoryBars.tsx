import { ChevronRight } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

import type { CategoryTotal } from '#/lib/expense.functions'
import { cn } from '#/lib/cn'

import { iconFor } from '#/lib/category-icons'
import { formatMoney } from '#/lib/money'
import { swatchColor } from '#/lib/swatches'

/**
 * Spending by category, as full-row bars.
 *
 * This replaced a donut. The reason is legibility rather than taste: a donut
 * forces the reader to compare arc lengths, which is the one comparison human
 * eyes are worst at, and it spends most of its own area on a hole with nothing
 * in it. Here the bar IS the row — it runs the full width behind the label and
 * the amount — so the number and its share of the largest category are read in
 * the same glance instead of being decoded from an angle.
 *
 * It also needs no charting library. The donut was the only thing in the app
 * using recharts, so this drops a dependency and its bundle weight.
 *
 * Bars are sized against the *largest* category rather than the total, so the
 * biggest one fills the row and the rest stay comparable to each other. Sizing
 * against the total would make the leader a sliver whenever spending is
 * concentrated, which is the normal case for a household.
 *
 * The widths animate from zero so a change of period or filter reads as a
 * movement rather than a jump — skipped under prefers-reduced-motion, and
 * skipped on first paint since SSR hands over markup that is already correct.
 */
export function CategoryBars({
  data,
  currency,
  totalMinor,
  onSelect,
  selectedId,
}: {
  data: Array<CategoryTotal>
  currency: string
  totalMinor: number
  /** Opens the ledger filtered to this category. Omit for a plain breakdown. */
  onSelect?: (categoryId: string) => void
  /** The category currently filtering the ledger, so its row can say so. */
  selectedId?: string
}) {
  const reduceMotion = useReducedMotion()

  // Only categories that actually spent something, biggest first. A category
  // filtered to zero is noise in a breakdown.
  const rows = data
    .filter((d) => d.totalMinor > 0)
    .sort((a, b) => b.totalMinor - a.totalMinor)

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-ink-faint">
        No spending in this period.
      </p>
    )
  }

  const largest = rows[0]?.totalMinor ?? 1

  return (
    <>
      <ul className="space-y-1">
        {rows.map((row) => {
          const Icon = iconFor(row.icon)
          const share = totalMinor > 0 ? row.totalMinor / totalMinor : 0
          // Never zero: a 0.1% category would otherwise render as an empty row
          // and read as "no data" rather than "a very small amount".
          const width = `${Math.max((row.totalMinor / largest) * 100, 1.5)}%`

          const isSelected = selectedId === row.id
          /*
           * The whole row is the control, rather than a small "see all" link at
           * the end of it.
           *
           * A breakdown is a list of questions and this one had no way to ask any
           * of them: EUR 1,925 in Home is an answer, and the reader's next thought
           * is "of what?". A row you can press is the shortest route from the
           * number to the entries behind it, and it puts the affordance where the
           * eye already is instead of in a separate column competing for attention.
           *
           * Only when `onSelect` is given. The same bars are used in contexts that
           * are not the ledger's, and a control that navigates somewhere the caller
           * did not ask for is worse than a static row.
           */
          const inner = (
            <>
              {/* The track spans the whole row, so the bar is read as the row's
                  own background rather than a widget inside it. */}
              <span
                aria-hidden
                className="absolute inset-0 -z-10 bg-[var(--color-paper-sunk)]"
              />
              <motion.span
                aria-hidden
                className="absolute inset-y-0 left-0 -z-10 rounded-[7px]"
                style={{
                  background: `linear-gradient(90deg,
                    color-mix(in oklab, ${swatchColor(row.color)} 26%, transparent),
                    color-mix(in oklab, ${swatchColor(row.color)} 11%, transparent))`,
                }}
                initial={reduceMotion ? false : { width: 0 }}
                animate={{ width }}
                transition={{ type: 'spring', stiffness: 130, damping: 24 }}
              />

              <div className="flex items-center gap-2 px-2 py-1.5">
                <span
                  aria-hidden
                  className="grid place-items-center size-7 shrink-0 rounded-[7px]"
                  style={{
                    background: `color-mix(in oklab, ${swatchColor(row.color)} 20%, transparent)`,
                  }}
                >
                  <Icon size={15} />
                </span>

                <span className="min-w-0 flex-1 truncate text-sm">
                  {row.name}
                </span>

                <span className="shrink-0 text-right">
                  <span className="tnum text-sm block leading-tight">
                    {formatMoney(row.totalMinor, currency)}
                  </span>
                  <span className="tnum text-[11px] text-ink-faint block leading-tight">
                    {(share * 100).toFixed(share < 0.1 ? 1 : 0)}%
                  </span>
                </span>
              </div>
            </>
          )

          return (
            <li key={row.id}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(row.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={cn(
                    'group relative isolate block w-full overflow-hidden rounded-[7px] text-left',
                    'transition-shadow duration-150',
                    isSelected &&
                      'shadow-[inset_0_0_0_1.5px_var(--color-terracotta)]',
                  )}
                >
                  {inner}
                  {/* The affordance. A chevron rather than a colour change,
                      because a tinted row among a list of tinted rows says nothing
                      about where it will take you. */}
                  <ChevronRight
                    size={14}
                    aria-hidden
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 shrink-0
                      text-ink-faint opacity-0 transition-opacity duration-150
                      group-hover:opacity-100 group-focus-visible:opacity-100
                      aria-[current]:opacity-100"
                  />
                </button>
              ) : (
                <div className="relative isolate overflow-hidden rounded-[7px]">
                  {inner}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <p className="mt-3 text-xs text-ink-faint">
        {formatMoney(totalMinor, currency)} across {rows.length}{' '}
        {rows.length === 1 ? 'category' : 'categories'}.
      </p>
    </>
  )
}
