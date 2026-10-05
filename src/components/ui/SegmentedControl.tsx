import { motion, useReducedMotion } from 'motion/react'

import type { ReactNode } from 'react'
import { cn } from '#/lib/cn'

/**
 * A segmented control whose selection slides.
 *
 * The thumb is a shared layout element rather than a background on the active
 * button, so moving between two options is one animated object travelling rather
 * than one button fading in while another fades out. That difference is the whole
 * micro-interaction: the second version reads as "these two things changed", and
 * this one reads as "this thing moved".
 *
 * `layoutId` does the work. Exactly one thumb is mounted at a time, on the active
 * option, so motion interpolates its position and size between the two.
 *
 * Reduced motion gets the same control with the thumb swapped instantly. What is
 * refused is the travel, not the selection.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: ReactNode; hint?: string }>
  onChange: (next: T) => void
  disabled?: boolean
  className?: string
}) {
  const reduceMotion = useReducedMotion()

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex gap-1.5 rounded-full neo p-1.5', className)}
    >
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.hint}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative px-3 py-1.5 text-sm rounded-full',
              'transition-colors duration-150',
              active ? 'text-ink font-medium' : 'text-ink-muted hover:text-ink',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${label}`}
                aria-hidden
                className="absolute inset-0 rounded-full neo-sm-inset"
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 480, damping: 34, mass: 0.8 }
                }
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
