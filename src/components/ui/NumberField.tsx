import { Minus, Plus } from 'lucide-react'
import { useId } from 'react'

import { cn } from '#/lib/cn'

/**
 * A number field with steppers.
 *
 * Replaces <input type="number">, which brings three problems at once: the
 * spinner arrows are drawn by the OS and cannot be restyled (so they either
 * clash with the design or have to be hidden), `type=number` silently discards
 * anything that is not a parseable number — a user cannot type "1." on the way
 * to "1.5" — and on mobile it raises a numeric keypad that has no way to show
 * the unit.
 *
 * Here the value is a plain string owned by the caller, so intermediate states
 * are representable, and the steppers are real buttons that work with a
 * keyboard and have accessible names.
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
}: {
  id?: string
  /** Raw text. Callers own it so a half-typed value is representable. */
  value: string
  onChange: (next: string) => void
  min?: number
  max?: number
  step?: number
  /** Rendered inside the field on the right — a unit, e.g. "%". */
  suffix?: string
  label?: string
  className?: string
  size?: 'sm' | 'md'
}) {
  const fallbackId = useId()

  function nudge(direction: 1 | -1) {
    const current = Number.parseFloat(value)
    const base = Number.isFinite(current) ? current : 0
    // Rounded to the step so repeated clicks do not accumulate float drift
    // (0.1 + 0.2 territory, which is visible at three decimal places).
    const next = Math.min(
      max,
      Math.max(min, Number((base + direction * step).toFixed(6))),
    )
    onChange(String(next))
  }

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-[var(--radius-md)]',
        'bg-paper-sunk border border-rule/70 shadow-[var(--shadow-deboss)]',
        'focus-within:border-terracotta focus-within:bg-[var(--color-paper-raised)]',
        'focus-within:shadow-[var(--shadow-deboss),0_0_0_3px_color-mix(in_oklab,var(--color-terracotta)_28%,transparent)]',
        'transition-[background-color,border-color,box-shadow] duration-150',
        className,
      )}
    >
      <StepButton
        onClick={() => nudge(-1)}
        disabled={Number.parseFloat(value) <= min}
        label="Decrease"
      >
        <Minus size={13} aria-hidden />
      </StepButton>

      <span className="relative flex items-center">
        <input
          id={id ?? fallbackId}
          type="text"
          inputMode="decimal"
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            // A fixed narrow width, not w-full: the steppers either side make
            // this an inline control, and letting the input stretch turned it
            // into the widest thing in the row.
            'tnum bg-transparent text-ink text-center min-w-0',
            'focus:outline-none appearance-none',
            size === 'sm'
              ? 'text-sm w-11 px-1 py-1.5'
              : 'text-base w-14 px-1 py-2',
          )}
        />
        {suffix && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-1.5
              text-xs text-ink-faint"
          >
            {suffix}
          </span>
        )}
      </span>

      <StepButton
        onClick={() => nudge(1)}
        disabled={Number.parseFloat(value) >= max}
        label="Increase"
      >
        <Plus size={13} aria-hidden />
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
        'grid place-items-center shrink-0 text-ink-muted',
        'transition-[color,background-color,transform] duration-150',
        'hover:text-ink active:scale-90 motion-reduce:active:scale-100',
        'disabled:opacity-30 disabled:pointer-events-none',
        'first:rounded-l-[var(--radius-md)] last:rounded-r-[var(--radius-md)]',
        'hover:bg-[var(--color-paper-raised)]',
      )}
    >
      {children}
    </button>
  )
}
