import { useEffect, useRef, useState } from 'react'

import type { PeriodPreset } from '#/lib/period'
import { DateField } from '#/components/ui/DateField'
import { rangeLabel } from '#/lib/calendar'
import { cn } from '#/lib/cn'

const PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
]

/**
 * The period control, on every screen that has one.
 *
 * Previously three: a joined segmented control on the dashboard and two
 * rows of separate pills elsewhere, with the custom range existing on exactly
 * one of them. That made "the same control" mean something different depending
 * on the page, and it is why Custom was ever missing from two screens.
 *
 * MINIMAL BY ONE CONTROL, NOT BY TWO SMALLER ONES
 * The range is a single button showing the span it currently covers, rather
 * than two date fields sitting beside the presets. Two fields inline are two
 * more bordered boxes competing with four pills on a 390px screen; one button
 * that reports the range as a phrase reads better and costs the width of a
 * word. The two pickers live in its popover, where there is room for them and
 * where they are not competing with anything.
 *
 * The button is always present and dimmed unless Custom is selected. Hiding it
 * would move everything below the filter when you chose Custom, and would hide
 * the only clue that Custom does anything at all.
 */
export function PeriodFilter({
  current,
  from,
  to,
  onChange,
  className,
}: {
  current: PeriodPreset
  from?: string
  to?: string
  onChange: (patch: {
    period?: PeriodPreset
    from?: string
    to?: string
  }) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<{ from?: string; to?: string }>({
    from,
    to,
  })
  const root = useRef<HTMLDivElement>(null)

  const custom = current === 'custom'

  // Reopening on a different range shows that range, not the last one typed.
  useEffect(() => {
    if (open) setDraft({ from, to })
  }, [open, from, to])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const label = rangeLabel(draft.from, draft.to)

  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-1.5', className)}>
      <div
        role="radiogroup"
        aria-label="Period"
        className="flex flex-wrap items-center gap-1.5"
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

      <div ref={root} className="relative">
        <button
          type="button"
          onClick={() => custom && setOpen((o) => !o)}
          disabled={!custom}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={
            custom ? 'Choose the range' : 'Pick Custom first to choose a range'
          }
          className={cn(
            'px-2.5 py-1.5 text-sm rounded-[var(--radius-sm)]',
            'border border-dashed border-rule/80',
            'transition-[color,background-color,border-color,opacity] duration-150',
            custom
              ? 'text-ink hover:bg-[var(--color-paper-sunk)] hover:border-terracotta/50'
              : // Dimmed rather than hidden: an inert control that is still
                // there explains why it is empty.
                'text-ink-faint opacity-55 cursor-not-allowed',
          )}
        >
          {label || 'Dates'}
        </button>

        {open && (
          <div
            role="dialog"
            aria-label="Date range"
            className="absolute z-50 mt-1.5 left-0 w-[min(21rem,calc(100vw-2rem))]
              rounded-[var(--radius-lg)] border border-rule
              bg-[var(--color-paper-raised)] p-3
              shadow-[var(--shadow-float)]"
          >
            <div className="flex items-center gap-2">
              <DateField
                id="range-from"
                label="From date"
                placeholder="From"
                compact
                value={draft.from ?? ''}
                onChange={(next) =>
                  setDraft((d) => ({ ...d, from: next || undefined }))
                }
                className="flex-1"
              />
              <span aria-hidden className="text-ink-faint text-sm">
                –
              </span>
              <DateField
                id="range-to"
                label="To date"
                placeholder="To"
                compact
                value={draft.to ?? ''}
                onChange={(next) =>
                  setDraft((d) => ({ ...d, to: next || undefined }))
                }
                className="flex-1"
              />
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onChange({ period: 'custom', from: draft.from, to: draft.to })
                  setOpen(false)
                }}
                className="flex-1 rounded-[var(--radius-sm)] py-1.5 text-sm
                  font-medium bg-[var(--color-terracotta)] text-[var(--color-ink)]
                  transition-transform duration-150 active:scale-[0.97]
                  motion-reduce:active:scale-100"
              >
                Apply
              </button>
              {(from || to) && (
                <button
                  type="button"
                  onClick={() => {
                    onChange({ from: undefined, to: undefined })
                    setDraft({})
                    setOpen(false)
                  }}
                  className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm
                    text-ink-muted transition-colors duration-150
                    hover:bg-[var(--color-paper-sunk)]"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
