import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { cn } from '#/lib/cn'

/**
 * A switch.
 *
 * Two things make this not just a styled checkbox:
 *
 *   • role="switch" with aria-checked, so a screen reader announces "on"/"off"
 *     rather than "checked" — the right semantics for something that changes
 *     behaviour immediately rather than on submit;
 *   • the thumb is a motion element, so it travels between the two ends with a
 *     spring instead of sliding at a fixed duration. That travel is most of why
 *     it feels like a physical switch rather than a box that changed colour.
 */
export function Switch({
  checked,
  onChange,
  label,
  id,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** Rendered as a visible label beside the switch. */
  label?: ReactNode
  id?: string
  className?: string
}) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2.5 cursor-pointer',
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
          'peer-focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-terracotta)_35%,transparent)]',
          checked
            ? 'bg-[var(--color-terracotta)] shadow-[var(--shadow-raise)]'
            : 'bg-[var(--color-paper-sunk)] shadow-[var(--shadow-deboss)]',
        )}
      >
        <motion.span
          className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-[var(--shadow-raise)]"
          animate={{ x: checked ? 20 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
        />
      </span>
      {label ? <span className="text-sm">{label}</span> : null}
    </label>
  )
}
