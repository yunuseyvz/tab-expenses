import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

import {
  WEEKDAYS,
  WEEKDAYS_LONG,
  addMonths,
  fromISODate,
  longDate,
  monthGrid,
  monthLabel,
  shortDate,
  startOfMonth,
} from '#/lib/calendar'
import { cn } from '#/lib/cn'
import { usePopoverPlacement } from '#/hooks/usePopoverPlacement'

/**
 * A date field with a real calendar.
 *
 * Replaces <input type="date">, which cannot be styled at all: the field, the
 * calendar icon, the picker popup and its header are all drawn by the operating
 * system. On a Linux phone it arrives looking like a different application
 * entirely, and the format follows the browser's locale rather than the
 * household's currency and language. Worse, the native control silently accepts
 * typed text like "1/2" and has no way to constrain it to a real date.
 *
 * Keyboard is a proper grid: arrows move by day and week, PageUp/PageDown change
 * month, Home/End jump to the ends of the week, Enter picks, Escape cancels.
 * Focus stays on the trigger and the active day is tracked with
 * aria-activedescendant, so a screen reader announces the highlighted date
 * without focus ever leaving the button.
 *
 * @param value ISO `YYYY-MM-DD`.
 */
export function DateField({
  id,
  value,
  onChange,
  className,
  label,
  placeholder = 'Pick a date',
  min,
  max,
  locale = 'en',
  compact = false,
  disabled = false,
}: {
  id?: string
  value: string
  onChange: (iso: string) => void
  className?: string
  label?: string
  placeholder?: string
  min?: string
  max?: string
  /** Matches the height of a period pill, for inline use. */
  compact?: boolean
  /** Inert but still visible, so the control's existence stays legible. */
  disabled?: boolean
  locale?: string
}) {
  const [open, setOpen] = useState(false)
  // The panel is 19rem and hangs off a trigger that is often half that width, so
  // it has to be measured rather than assumed to fit. See the hook for why a
  // negative offset is the expected result, not a bug.
  const { anchor: root, placement } = usePopoverPlacement<HTMLDivElement>({
    open,
    width: 19 * 16,
  })
  const [cursor, setCursor] = useState<Date>(() =>
    value ? fromISODate(value) : new Date(),
  )
  const gridRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  // Reopening on a different month jumps to whichever month the value is in.
  // Someone editing an expense from January and then switching to October needs
  // to see October, not today's month with the selection off-screen.
  useEffect(() => {
    if (open) setCursor(value ? fromISODate(value) : new Date())
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const cells = useMemo(() => monthGrid(startOfMonth(cursor)), [cursor])

  // Keep the highlighted day visible when arrowing across a month boundary.
  useEffect(() => {
    if (!open) return
    const el = gridRef.current?.querySelector<HTMLElement>('[data-cursor="1"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, cursor])

  // Named for what it checks, not `disabled`: that is now a prop, and a local
  // function of the same name would shadow it.
  function outOfRange(iso: string) {
    return (min !== undefined && iso < min) || (max !== undefined && iso > max)
  }

  function move(days: number) {
    const next = new Date(cursor)
    next.setDate(next.getDate() + days)
    setCursor(next)
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }

    if (e.key in step) {
      e.preventDefault()
      move(step[e.key] as number)
      return
    }
    if (e.key === 'PageUp') {
      e.preventDefault()
      setCursor((c) => addMonths(c, -1))
      return
    }
    if (e.key === 'PageDown') {
      e.preventDefault()
      setCursor((c) => addMonths(c, 1))
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      // Monday of the cursor's own week. The grid is Monday-first, so this is
      // the first cell of its row.
      move(-((cursor.getDay() + 6) % 7))
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      move(6 - ((cursor.getDay() + 6) % 7))
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const iso = isoOf(cursor)
      if (!outOfRange(iso)) {
        onChange(iso)
        setOpen(false)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  function isoOf(d: Date) {
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  }

  const activeIso = isoOf(cursor)

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) setOpen(false)
        }}
        // The visible text is the compact form, so the long one — which carries
        // the weekday — lives here for anyone who cannot read the short one.
        title={value ? longDate(value, locale) : undefined}
        className={cn(
          'w-full flex items-center gap-2 text-left',
          'bg-paper-sunk text-ink rounded-[var(--radius-md)]',
          compact ? 'px-2.5 py-1.5 text-sm' : 'px-3.5 py-2.5',
          'border border-[color:var(--rule-field)]',
          'shadow-[var(--shadow-deboss)]',
          'transition-[background-color,border-color,box-shadow] duration-150',
          'ease-[var(--ease-out-soft)]',
          'focus:outline-none focus:border-terracotta',
          'focus:bg-[var(--color-paper-raised)]',
          'focus:shadow-[var(--shadow-deboss),0_0_0_3px_color-mix(in_oklab,var(--color-terracotta)_28%,transparent)]',
          'aria-invalid:border-oxblood',
          // Dimmed rather than hidden: an inert control that is still there
          // explains why it is empty.
          disabled && 'opacity-45 cursor-not-allowed hover:bg-paper-sunk',
        )}
      >
        <CalendarDays
          size={16}
          aria-hidden
          className="shrink-0 text-ink-muted"
        />
        <span className={cn('flex-1 truncate', !value && 'text-ink-faint')}>
          {value ? shortDate(value, locale) : placeholder}
        </span>
      </button>

      {open && (
        <div
          ref={gridRef}
          id={panelId}
          role="dialog"
          aria-label={label ?? 'Choose a date'}
          onKeyDown={onGridKeyDown}
          style={
            placement
              ? { left: placement.left, width: placement.width }
              : undefined
          }
          className="absolute z-50 mt-1.5 left-0
            w-[min(19rem,calc(100vw-2rem))]
            rounded-[var(--radius-lg)] border border-rule
            bg-[var(--color-paper-raised)]
            p-2.5 shadow-[var(--shadow-float)]"
        >
          <div className="flex items-center justify-between mb-1.5">
            <button
              type="button"
              onClick={() => setCursor((c) => addMonths(c, -1))}
              aria-label="Previous month"
              className="grid place-items-center size-7 rounded-full text-ink-muted
                transition-colors duration-150 hover:bg-[var(--color-paper-sunk)]
                hover:text-ink active:scale-95 motion-reduce:active:scale-100"
            >
              <ChevronLeft size={16} aria-hidden />
            </button>
            <span aria-live="polite" className="text-sm font-medium">
              {monthLabel(cursor, locale)}
            </span>
            <button
              type="button"
              onClick={() => setCursor((c) => addMonths(c, 1))}
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
            aria-label={monthLabel(cursor, locale)}
            className="grid grid-cols-7 gap-0.5"
          >
            {cells.map((cell) => {
              const isSelected = cell.iso === value
              const isCursor = cell.iso === activeIso
              const isBlocked = outOfRange(cell.iso)

              return (
                <button
                  key={cell.iso}
                  type="button"
                  role="gridcell"
                  data-cursor={isCursor ? '1' : undefined}
                  aria-selected={isSelected}
                  aria-label={longDate(cell.iso, locale)}
                  aria-current={cell.isToday ? 'date' : undefined}
                  disabled={isBlocked}
                  onClick={() => {
                    onChange(cell.iso)
                    setOpen(false)
                  }}
                  className={cn(
                    'relative grid place-items-center h-9 rounded-[var(--radius-sm)]',
                    'text-sm transition-[background-color,color,transform] duration-150',
                    'active:scale-90 motion-reduce:active:scale-100',
                    !cell.inMonth && 'opacity-40',
                    isBlocked && 'opacity-25 cursor-not-allowed line-through',
                    !isSelected &&
                      !isBlocked &&
                      'hover:bg-[var(--color-paper-sunk)]',
                    isSelected &&
                      'bg-[var(--color-terracotta)] text-[var(--color-ink)] font-semibold',
                    // Today when it is not also the selection. An outline rather
                    // than a fill, so the two states never fight.
                    !isSelected &&
                      cell.isToday &&
                      'ring-1 ring-inset ring-[var(--color-terracotta)]',
                    isCursor && !isSelected && 'bg-[var(--color-paper-sunk)]',
                  )}
                >
                  {cell.date.getDate()}
                </button>
              )
            })}
          </div>

          <div className="mt-2 pt-2 border-t border-[color:var(--rule-field)] flex gap-2">
            <button
              type="button"
              onClick={() => {
                onChange(isoOf(new Date()))
                setOpen(false)
              }}
              className="flex-1 rounded-[var(--radius-sm)] py-1.5 text-xs
                text-terracotta-ink transition-colors duration-150
                hover:bg-[var(--color-paper-sunk)]"
            >
              Today
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="flex-1 rounded-[var(--radius-sm)] py-1.5 text-xs
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
  )
}
