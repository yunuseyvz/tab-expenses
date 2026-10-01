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
 * The period control, with a custom range.
 *
 * Used on the expenses screen only. The dashboard deliberately does NOT get
 * this: it shows a headline total and a category breakdown, and a custom range
 * there invites narrowing a summary until it says nothing. If someone needs a
 * window over the list, they go to the list.
 *
 * The two date fields are always rendered rather than appearing on "Custom".
 * Conditionally adding a control is what caused the earlier layout jump — the
 * page below moved the moment you touched the preset — and it also hid the only
 * clue that "Custom" does something. Greyed out and inert until it is chosen
 * costs nothing and reads as one control rather than two states of it.
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
      {/* gap-1.5 and px-2.5 rather than gap-2/px-3: the four pills come to
          roughly 315px, which fits the 358px of content width on a 390px phone
          once they are tightened. At the looser spacing the fourth wrapped onto
          its own row. */}
      <div
        role="radiogroup"
        aria-label="Period"
        className="flex flex-wrap gap-1.5"
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

      <span aria-hidden className="text-ink-faint text-sm">
        –
      </span>

      <DateField
        id="period-from"
        label="From date"
        placeholder="From"
        value={from ?? ''}
        // Disabled rather than hidden: an inert control that is still there
        // tells you the range exists and why it is empty.
        disabled={!custom}
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
        disabled={!custom}
        onChange={(next) => onChange({ to: next || undefined })}
        className="w-[9.5rem]"
        compact
      />
    </div>
  )
}
