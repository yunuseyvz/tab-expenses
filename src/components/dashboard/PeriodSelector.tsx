import type { PeriodPreset } from '#/lib/period'
import { DateField } from '#/components/ui/DateField'
import { cn } from '#/lib/cn'

const PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
]

/**
 * The period control on the dashboard.
 *
 * Now visually identical to InlinePeriod, which the expenses and balances
 * screens use. They were different for no reason that survived: this one was a
 * joined segmented control sitting in a well, the other a row of separate
 * raised pills, and the second read better in both — it has more air between the
 * options and each one is clearly its own target. Sharing the look also means
 * "Custom" behaves the same on both screens.
 *
 * The custom range sits inline, to the right of the presets, at the same
 * height. It used to drop onto its own row underneath, which pushed the
 * category chips and everything below it down the page the moment you picked
 * "Custom" — a layout jump for a control the user had just chosen.
 */
export function PeriodSelector({
  current,
  from,
  to,
  onChange,
}: {
  current: PeriodPreset
  from?: string
  to?: string
  onChange: (patch: {
    period?: PeriodPreset
    from?: string
    to?: string
  }) => void
}) {
  const custom = current === 'custom'

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <div
        role="radiogroup"
        aria-label="Period"
        className="flex flex-wrap gap-2"
      >
        {PRESETS.map((p) => {
          const active = current === p.key
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange({ period: p.key })}
              className={cn(
                'px-2.5 py-1.5 text-sm rounded-[var(--radius-sm)]',
                'transition-[background-color,box-shadow] duration-150',
                active
                  ? 'bg-paper-raised shadow-[var(--shadow-raise)]'
                  : 'bg-paper-sunk shadow-[var(--shadow-deboss)]',
              )}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {custom && (
        <div className="flex flex-wrap items-center gap-2">
          <DateField
            id="period-from"
            label="From date"
            placeholder="From"
            value={from ?? ''}
            onChange={(next) => onChange({ from: next || undefined })}
            className="w-[9.5rem]"
            compact
          />
          <span aria-hidden className="text-ink-faint text-sm">
            –
          </span>
          <DateField
            id="period-to"
            label="To date"
            placeholder="To"
            value={to ?? ''}
            onChange={(next) => onChange({ to: next || undefined })}
            className="w-[9.5rem]"
            compact
          />
        </div>
      )}
    </div>
  )
}
