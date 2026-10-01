import { useEffect, useRef, useState } from 'react'

import type { PeriodPreset } from '#/lib/period'
import { DateField } from '#/components/ui/DateField'
import { usePopoverPlacement } from '#/hooks/usePopoverPlacement'
import { cn } from '#/lib/cn'

const PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
]

const PANEL_WIDTH = 300

/**
 * The period control, on every screen that has one.
 *
 * Previously three: a joined segmented control on the dashboard and two rows of
 * separate pills elsewhere, with the custom range on exactly one of them. That
 * made "the same control" mean something different depending on the page, and
 * it is why Custom was ever missing from two screens.
 *
 * CUSTOM IS ITS OWN DISCLOSURE
 * The two attempts before this were both wrong in instructive ways. A trailing
 * "Dates" button needed a trigger of its own merely to stay dimmed until Custom
 * was chosen, and its popover — wider than its own button — hung off the right
 * edge of a phone. Putting the fields on a row of their own fixed the overflow
 * but cost a line of vertical space on every screen, permanently, to show two
 * controls that are meaningless nine times out of ten.
 *
 * So Custom opens the panel itself. There is nothing else to click, nothing
 * inert to grey out, and nothing to reserve space for. The panel hangs off the
 * Custom pill, which is the one control whose meaning is "I want to set dates".
 *
 * Dates apply as they are picked — no Apply button — because every other control
 * in this filter takes effect on click, and a button that only says "Apply" next
 * to two fields that visibly change the list underneath is noise.
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
  const custom = current === 'custom'
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const { anchor, placement } = usePopoverPlacement<HTMLSpanElement>({
    open,
    width: PANEL_WIDTH,
  })

  // A popover that outlives the thing it is about is worse than no popover.
  useEffect(() => {
    if (!custom) setOpen(false)
  }, [custom])

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

  const unbounded = !from && !to

  return (
    <div ref={root} className={cn('mb-4', className)}>
      <div
        role="radiogroup"
        aria-label="Period"
        className="flex flex-wrap items-center gap-1.5"
      >
        {PRESETS.map((p) => {
          const active = current === p.key
          const isCustom = p.key === 'custom'
          const pill = (
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-haspopup={isCustom ? 'dialog' : undefined}
              aria-expanded={isCustom ? open : undefined}
              onClick={() => {
                if (!isCustom) {
                  onChange({ period: p.key })
                  return
                }
                // First press selects it *and* opens the panel, because a
                // control that changes state without showing you what the state
                // does is the definition of a dead end. A second press closes it.
                if (!active) onChange({ period: p.key })
                setOpen((o) => (active ? !o : true))
              }}
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

          if (!isCustom) return pill

          return (
            <span key={p.key} ref={anchor} className="relative inline-flex">
              {pill}
              {open && (
                <div
                  role="dialog"
                  aria-label="Custom date range"
                  style={
                    placement
                      ? { left: placement.left, width: placement.width }
                      : undefined
                  }
                  // top-full, not just a margin: without it `top` is auto, the
                  // panel falls back to its static position beside the pill, and
                  // it swallows the very click that is meant to close it.
                  className="absolute z-50 top-full mt-1.5 left-0
                    w-[min(18.75rem,calc(100vw-1rem))]
                    rounded-[var(--radius-lg)] border border-rule
                    bg-[var(--color-paper-raised)]
                    p-3 shadow-[var(--shadow-float)]"
                >
                  <div className="space-y-2">
                    <div>
                      <span className="block text-xs text-ink-faint mb-1">
                        From
                      </span>
                      <DateField
                        label="From date"
                        placeholder="Any date"
                        compact
                        value={from ?? ''}
                        onChange={(v) => onChange({ from: v || undefined })}
                      />
                    </div>
                    <div>
                      <span className="block text-xs text-ink-faint mb-1">
                        To
                      </span>
                      <DateField
                        label="To date"
                        placeholder="Any date"
                        compact
                        value={to ?? ''}
                        onChange={(v) => onChange({ to: v || undefined })}
                      />
                    </div>
                  </div>

                  {/* Stated rather than left to be inferred: an empty range
                      means no bounds, which means everything. Without this,
                      choosing Custom looks like it did nothing at all — which is
                      indistinguishable from a filter that is broken. */}
                  {unbounded && (
                    <p className="mt-2.5 text-xs text-ink-faint">
                      No dates set — showing everything.
                    </p>
                  )}

                  {!unbounded && (
                    <button
                      type="button"
                      onClick={() =>
                        onChange({ from: undefined, to: undefined })
                      }
                      className="mt-2.5 text-xs text-ink-muted
                        transition-colors duration-150 hover:text-ink
                        underline underline-offset-4"
                    >
                      Clear dates
                    </button>
                  )}
                </div>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
