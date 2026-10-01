import type { PeriodPreset } from '#/lib/period'

const PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'all', label: 'All' },
]

/**
 * Compact three-preset period toggle for the secondary screens, where the full
 * PeriodSelector (with its custom range) would be more chrome than the screen
 * needs. Client-side navigation, not <a href>, so it stays an SPA transition.
 */
export function InlinePeriod({
  current,
  onChange,
}: {
  current: PeriodPreset
  onChange: (preset: PeriodPreset) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Period"
      className="mb-4 flex flex-wrap gap-2"
    >
      {PRESETS.map((p) => {
        const active = current === p.key
        return (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(p.key)}
            className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)]
              transition-[background-color,box-shadow] duration-150"
            style={{
              background: active
                ? 'var(--color-paper-raised)'
                : 'var(--color-paper-sunk)',
              boxShadow: active
                ? 'var(--shadow-raise)'
                : 'var(--shadow-deboss)',
            }}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}
