/**
 * The period control, on every screen that has one.
 *
 * ONE DROPDOWN, not a row of pills. There are eight bounded presets plus a custom
 * range, and a control with nine options does not fit on a phone in any
 * arrangement: as pills it wrapped onto three lines and pushed the numbers below
 * it down the screen, and trimmed to three it made the week and the quarter
 * second-class. So the control is a single button naming the window you picked,
 * with every other choice inside it. One line everywhere, nothing unreachable.
 *
 * This is the same argument the earlier redesign made about the *custom range*,
 * which was a second control sitting beside the presets. Two controls answering
 * one question ("which dates am I looking at") was the original mistake, and
 * adding presets to one of them without folding the other in would have rebuilt
 * it. The two date fields live inside this panel, not behind their own trigger.
 *
 * The button names the preset you picked rather than repeating the dates it
 * resolves to, because the screen header above it already states the window and
 * two identical strings forty pixels apart read as a fault. A custom range has
 * no name to show, so that one *is* the dates, formatted by `periodLabel` — the
 * same function the header uses, so a range is described in one way in the app.
 *
 * Dates apply as they are picked, with no Apply button, because every other
 * control here takes effect on click and a button labelled only "Apply" beside
 * fields that visibly redraw the list underneath is noise.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarRange, Check, ChevronDown } from 'lucide-react'

import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import type { PeriodPreset } from '#/lib/period'
import { PERIOD_PRESETS, periodControlLabel } from '#/lib/period'
import { DateField } from '#/components/ui/DateField'
import { usePopoverPlacement } from '#/hooks/usePopoverPlacement'
import { cn } from '#/lib/cn'

const PANEL_WIDTH = 268

/**
 * The bounded presets plus the custom range, in one list.
 *
 * `PERIOD_PRESETS` holds only the eight bounded ones, so `custom` is added here
 * rather than being a pill of its own somewhere else. Order is deliberately the
 * cadence ladder — week, fortnight, month, quarter — with the past twins beside
 * their present and "All" at the end, which is how the data is stored and how
 * anybody looks for a window.
 */
const CHOICES = [
  ...PERIOD_PRESETS.map(({ key, label }) => ({ key, label })),
  { key: 'custom' as const, label: 'Custom range' },
]

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
  const root = useRef<HTMLDivElement>(null)
  const options = useRef<Array<HTMLButtonElement | null>>([])
  const { anchor, panel, panelEl, floating } =
    usePopoverPlacement<HTMLButtonElement>({ open, width: PANEL_WIDTH })

  const showDates = current === 'custom'

  // A popover that outlives the thing it is about is worse than no popover: pick
  // a preset and there is nothing left inside it to adjust, so it closes. Custom
  // is the exception — it *is* the adjustment, and the panel closes on the pick
  // that reveals the fields.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      // Both halves, because the panel is portalled and is therefore not inside
      // `root`. Checking only `root` would close it the instant you touched it.
      if (!root.current?.contains(target) && !panelEl?.contains(target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      // Focus is on an option inside the panel, and the panel is about to
      // unmount, which drops focus onto <body> — so the control that opened it
      // can no longer be reopened without starting the tab order from the top of
      // the document again. Verified in a browser: Escape used to land on body
      // and a following Enter did nothing at all.
      anchor.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, panelEl])

  /**
   * Roving focus over the choices.
   *
   * Not decoration. The pills were tabbable in series, and a portal puts the
   * panel at the end of the tab order, so without this the options would be
   * reachable only by tabbing past the entire rest of the page — which is how a
   * control that becomes the *only* way to pick a window ends up unusable by
   * keyboard. Focus moves rather than the selection; Space and Enter still pick,
   * as they do on any button.
   */
  const moveFocus = (at: number, delta: number) => {
    const next = (at + delta + CHOICES.length) % CHOICES.length
    options.current[next]?.focus()
  }

  const onTriggerKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    setOpen(true)
    // Wait for the panel to mount before reaching into it.
    queueMicrotask(() => {
      const at = Math.max(
        0,
        CHOICES.findIndex((c) => c.key === current),
      )
      options.current[at]?.focus()
    })
  }

  /**
   * What the button says.
   *
   * The preset's name, not the dates it resolves to: the screen header above
   * already states the window, and two identical strings forty pixels apart read
   * as a rendering fault. A custom range has no name to show, so that one *is* the
   * dates. `periodControlLabel` owns the decision, including what to do about a
   * `?period=` this build does not recognise — which used to render an empty
   * button.
   */
  const label = useMemo(
    () => periodControlLabel(current, from, to),
    [current, from, to],
  )

  return (
    <div ref={root} className={cn('mb-4', className)}>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex max-w-full items-center gap-2
          rounded-[var(--radius-sm)] bg-paper-raised px-3 py-1.5 text-sm
          shadow-[var(--shadow-raise)] transition-colors duration-150"
      >
        <CalendarRange
          size={15}
          aria-hidden
          className="shrink-0 text-ink-faint"
        />
        {/* The window is the label. `truncate` on the flex child, not the
            button, so a long custom range shrinks instead of pushing the
            chevron out of the control. */}
        <span className="tnum truncate">{label}</span>
        <ChevronDown
          size={14}
          aria-hidden
          className="shrink-0 text-ink-muted transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
        />
      </button>

      {open &&
        floating &&
        createPortal(
          <div
            ref={panel}
            style={{
              left: floating.left,
              top: floating.top,
              width: floating.width,
            }}
            className="fixed z-[60] rounded-[var(--radius-md)] border border-rule
              bg-[var(--color-paper-raised)] p-1.5 shadow-[var(--shadow-float)]"
          >
            {/* The listbox holds options and nothing else. The date fields below
                are not options, and putting a form inside a listbox tells a
                screen reader the fields are choices. */}
            <div role="listbox" aria-label="Period">
              {CHOICES.map(({ key, label: optionLabel }, i) => {
                const active = current === key
                return (
                  <button
                    key={key}
                    ref={(el) => {
                      options.current[i] = el
                    }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        moveFocus(i, 1)
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        moveFocus(i, -1)
                      }
                    }}
                    onClick={() => {
                      onChange({ period: key })
                      // Every choice but custom leaves nothing in the panel to
                      // adjust, and a popover left hanging over a list that has
                      // already changed is just in the way.
                      if (key !== 'custom') setOpen(false)
                      // Back to the trigger, because the option that had focus is
                      // about to unmount with the panel. Without this, picking a
                      // window by mouse or by Enter drops focus onto <body> and
                      // the next Tab starts again from the top of the document.
                      anchor.current?.focus()
                    }}
                    className={cn(
                      'flex w-full items-center gap-2',
                      'rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm',
                      'transition-colors duration-150',
                      'hover:bg-[var(--color-paper-sunk)]',
                      active && 'font-medium',
                    )}
                  >
                    <Check
                      size={13}
                      aria-hidden
                      className={cn(
                        'shrink-0 text-ink-faint',
                        !active && 'invisible',
                      )}
                    />
                    <span className="truncate">{optionLabel}</span>
                  </button>
                )
              })}
            </div>

            {showDates && (
              <div className="mt-1.5 space-y-2 border-t border-rule px-0.5 pt-2.5">
                <div>
                  <span className="mb-1 block text-xs text-ink-faint">
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
                  <span className="mb-1 block text-xs text-ink-faint">To</span>
                  <DateField
                    label="To date"
                    placeholder="Any date"
                    compact
                    value={to ?? ''}
                    onChange={(v) => onChange({ to: v || undefined })}
                  />
                </div>
                {(from || to) && (
                  <button
                    type="button"
                    onClick={() => onChange({ from: undefined, to: undefined })}
                    className="pt-0.5 text-xs text-terracotta-ink underline
                      underline-offset-2"
                  >
                    Clear dates
                  </button>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
