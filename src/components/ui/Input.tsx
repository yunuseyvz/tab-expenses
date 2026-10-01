import type { ComponentProps } from 'react'

import { cn } from '#/lib/cn'

export { Select } from './Listbox'

/**
 * The input.
 *
 * Was a hard-edged debossed underline, which is the skeuomorphic pattern the
 * art direction was trying to move away from — and it read as 1998. This is now
 * a soft inset field with a full-width focus ring, which is what makes the
 * rest of the interface feel like the same material as the OS rather than
 * something assembled from parts.
 *
 * Everything that moves is `background-color`, `border-color`, `box-shadow` or
 * `transform`. Width, height and top/left are never transitioned, because they
 * force layout on every frame and stutter visibly on mid-range Android.
 */
const field = cn(
  'w-full bg-paper-sunk text-ink rounded-[var(--radius-md)]',
  'px-3.5 py-2.5',
  'border border-[color:var(--rule-field)]',
  'shadow-[var(--shadow-deboss)]',
  'transition-[background-color,border-color,box-shadow] duration-150',
  'ease-[var(--ease-out-soft)]',
  'placeholder:text-ink-faint',
  // The ring is a ring, not a shadow cast on the page: it must be visible at
  // 3:1 against whatever surface the field sits on, including paper-sunk.
  'focus:outline-none focus:border-terracotta focus:bg-[var(--color-paper-raised)]',
  'focus:shadow-[var(--shadow-deboss),0_0_0_3px_color-mix(in_oklab,var(--color-terracotta)_28%,transparent)]',
  'aria-invalid:border-oxblood',
  'disabled:opacity-60 disabled:cursor-not-allowed',
)

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(field, className)} {...props} />
}

/** Visible label. Always paired with an Input — placeholder is not a label. */
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      className={cn(
        'block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted mb-1.5',
        className,
      )}
      {...props}
    />
  )
}

/** Multi-line field, same language as Input. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'resize-y', className)} {...props} />
}
