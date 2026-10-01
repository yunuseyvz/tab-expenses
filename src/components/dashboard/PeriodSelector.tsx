import { useNavigate } from '@tanstack/react-router'

import type { PeriodPreset } from '#/lib/period'
import { cn } from '#/lib/cn'

const PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
]

/**
 * Period selector. State lives in the URL so a period is shareable and
 * survives a refresh, and the query keys downstream pick it up automatically.
 *
 * `from`/`to` are the custom range; `period` is the preset. They are separate
 * search params rather than one overloaded field so switching back to a preset
 * does not lose the custom dates.
 */
export function PeriodSelector({
  current,
  from,
  to,
}: {
  current: PeriodPreset
  from?: string
  to?: string
}) {
  const navigate = useNavigate()

  const go = (
    patch: Partial<{
      space: string | undefined
      period: PeriodPreset
      cats: string | undefined
      from: string | undefined
      to: string | undefined
    }>,
  ) => {
    void navigate({
      to: '/dashboard',
      search: {
        space: undefined,
        period: current,
        cats: undefined,
        from,
        to,
        ...patch,
      },
    })
  }

  return (
    <div className="mb-4">
      <div
        role="radiogroup"
        aria-label="Period"
        className="inline-flex p-1 gap-1 well rounded-[var(--radius-sm)]"
      >
        {PRESETS.map((p) => {
          const active = current === p.key
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => go({ period: p.key })}
              className={cn(
                'px-3 py-1.5 text-sm rounded-[2px]',
                'transition-[background-color,box-shadow,color] duration-150',
                active
                  ? 'bg-paper-raised text-ink shadow-[var(--shadow-raise)]'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {current === 'custom' && (
        <div className="flex items-end gap-3 mt-3">
          <div>
            <label
              htmlFor="period-from"
              className="block text-xs uppercase tracking-wide text-ink-muted mb-1"
            >
              From
            </label>
            <input
              id="period-from"
              type="date"
              value={from ?? ''}
              onChange={(e) =>
                go({ period: 'custom', from: e.target.value || undefined })
              }
              className="bg-paper-sunk px-2 py-1.5 text-sm rounded-[var(--radius-sm)]
                shadow-[var(--shadow-deboss)]
                focus:shadow-[var(--shadow-raise)]"
            />
          </div>
          <div>
            <label
              htmlFor="period-to"
              className="block text-xs uppercase tracking-wide text-ink-muted mb-1"
            >
              To
            </label>
            <input
              id="period-to"
              type="date"
              value={to ?? ''}
              onChange={(e) =>
                go({ period: 'custom', to: e.target.value || undefined })
              }
              className="bg-paper-sunk px-2 py-1.5 text-sm rounded-[var(--radius-sm)]
                shadow-[var(--shadow-deboss)]
                focus:shadow-[var(--shadow-raise)]"
            />
          </div>
        </div>
      )}
    </div>
  )
}
