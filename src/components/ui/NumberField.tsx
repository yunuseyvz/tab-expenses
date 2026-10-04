import { Minus, Plus } from 'lucide-react'
import { useId } from 'react'

import { cn } from '#/lib/cn'

/**
 * A percentage stepper.
 *
 * Replaces <input type=number>, which brings three problems at once: the spinner
 * arrows are drawn by the OS and cannot be restyled, `type=number` silently
 * discards anything unparseable — so a user cannot type "1." on the way to
 * "1.5" — and on mobile it raises a numeric keypad that cannot show the unit.
 *
 * The first version of this looked like a form field that had been shrunk until
 * it fitted: a hard border, a grey well, and three boxed segments. It read as
 * an input dropped into the middle of a slider row rather than as part of it.
 *
 * So at rest it has no chrome at all — just the number, the unit and two quiet
 * glyphs — and the inset well only appears on hover or focus. It reads as a
 * label on the slider, and reveals that it is editable when you go near it.
 * Everything animated is background, colour or transform.
 *
 * The value is a plain string owned by the caller so intermediate states are
 * representable, and the steppers round to the step so repeated clicks do not
 * accumulate float drift.
 */
export function NumberField({
  id,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix,
  label,
  className,
  size = 'sm',
  disabled = false,
}: {
  id?: string
  /** Raw text. Callers own it so a half-typed value is representable. */
  value: string
  onChange: (next: string) => void
  min?: number
  max?: number
  step?: number
  /** Unit shown beside the number — "%". */
  suffix?: string
  label?: string
  className?: string
  size?: 'sm' | 'md'
  /** Inert but still legible, so a read-only split keeps its figures. */
  disabled?: boolean
}) {
  const fallbackId = useId()
  const numeric = Number.parseFloat(value)
  const atMin = disabled || (Number.isFinite(numeric) && numeric <= min)
  const atMax = disabled || (Number.isFinite(numeric) && numeric >= max)

  function nudge(direction: 1 | -1) {
    const base = Number.isFinite(numeric) ? numeric : 0
    onChange(
      String(
        Math.min(
          max,
          Math.max(min, Number((base + direction * step).toFixed(6))),
        ),
      ),
    )
  }

  return (
    <div
      className={cn(
        // rounded-full rather than a radius, because the height is small and a
        // pill reads as one object rather than three.
        'group/nf inline-flex items-center rounded-full',
        'transition-[background-color,box-shadow] duration-200',
        'ease-[var(--ease-out-soft)]',
        !disabled && 'hover:bg-[var(--color-paper-sunk)]',
        'focus-within:bg-[var(--color-paper-sunk)]',
        'focus-within:shadow-[var(--shadow-deboss)]',
        disabled && 'opacity-50',
        className,
      )}
    >
      <StepButton
        onClick={() => nudge(-1)}
        disabled={atMin || disabled}
        label="Decrease"
      >
        <Minus size={14} aria-hidden strokeWidth={2.25} />
      </StepButton>

      <span className="relative flex items-baseline">
        <input
          id={id ?? fallbackId}
          type="text"
          inputMode="decimal"
          value={value}
          aria-label={label}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'tnum bg-transparent text-ink text-center appearance-none',
            'focus:outline-none min-w-0',
            // `w-11` rather than `w-9` because the value it has to hold is not
            // always a round number: an uneven split prints one decimal, and
            // "25.2" in a nine-wide field scrolls its own last digit out of
            // sight, which reads as a wrong figure rather than a clipped one.
            size === 'sm' ? 'text-base w-11' : 'text-lg w-14',
          )}
        />
        {suffix && (
          <span
            aria-hidden
            className="pointer-events-none text-[0.7em] text-ink-faint -ml-0.5"
          >
            {suffix}
          </span>
        )}
      </span>

      <StepButton
        onClick={() => nudge(1)}
        disabled={atMax || disabled}
        label="Increase"
      >
        <Plus size={14} aria-hidden strokeWidth={2.25} />
      </StepButton>
    </div>
  )
}

function StepButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        // Quiet by default, legible on approach. The glyph carries the
        // affordance; the background is only confirmation.
        'grid place-items-center shrink-0 text-ink-faint rounded-full',
        'size-6 transition-[color,background-color,transform] duration-150',
        'hover:text-ink hover:bg-[var(--color-paper-raised)]',
        'focus-visible:outline-none focus-visible:text-ink',
        'focus-visible:bg-[var(--color-paper-raised)]',
        'active:scale-90 motion-reduce:active:scale-100',
        'disabled:opacity-25 disabled:pointer-events-none',
      )}
    >
      {children}
    </button>
  )
}
