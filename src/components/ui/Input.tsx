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
  // Sunk into the page rather than sitting on it: the same paired treatment the
  // pills get, inside out. A field is a recess by definition, and the old single
  // inset shadow made it look like a hole cut in a card instead of part of the
  // same material.
  'w-full bg-[var(--color-neo-sunk)] text-ink rounded-[var(--radius-control)]',
  'px-3.5 py-2.5',
  // The border stays. As with the secondary button, the neumorphic pair is a
  // material and not an edge, and 1.4.11 wants 3:1 on the boundary of a control.
  'border border-[color:var(--rule-field)]',
  'shadow-[var(--shadow-neo-inset)]',
  'transition-[background-color,border-color,box-shadow] duration-150',
  'ease-[var(--ease-out-soft)]',
  'placeholder:text-ink-faint',
  // Focus lifts the field back OUT of the page and rings it: a recess that got
  // deeper would be ambiguous about where the typing went, and the ring is what
  // says this one, now.
  'focus:outline-none focus:border-terracotta focus:bg-[var(--color-neo)]',
  'focus:shadow-[var(--shadow-neo),0_0_0_3px_color-mix(in_oklab,var(--color-terracotta)_28%,transparent)]',
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
