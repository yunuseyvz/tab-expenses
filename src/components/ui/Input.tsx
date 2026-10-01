import type { ComponentProps } from 'react'

import { cn } from '#/lib/cn'

/**
 * The Sera-style input: a debossed underline, not a boxed field. A ruled line
 * on a form is exactly the skeuomorphic pattern we want, so the base style and
 * the art direction agree instead of fighting.
 *
 * At rest the field is sunk into the paper; focus lifts it and tints the rule
 * terracotta. Only background-color and border-color transition.
 */
export function Input({
  className,
  ...props
}: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'w-full bg-paper-sunk px-3 py-2 text-ink rounded-[3px]',
        'shadow-[var(--shadow-deboss)]',
        'border-b-2 border-transparent',
        'transition-[background-color,border-color] duration-150',
        'placeholder:text-ink-faint',
        'focus:shadow-[var(--shadow-raise)] focus:border-terracotta focus:outline-none',
        'focus-visible:outline-none',
        'aria-invalid:border-oxblood',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  )
}

/** Visible label. Always paired with an Input — placeholder is not a label. */
export function Label({
  className,
  ...props
}: ComponentProps<'label'>) {
  return (
    <label
      className={cn(
        'block text-xs font-medium uppercase tracking-wide text-ink-muted mb-1.5',
        className,
      )}
      {...props}
    />
  )
}

/** Debossed multi-line field, same language as Input. */
export function Textarea({
  className,
  ...props
}: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full bg-paper-sunk px-3 py-2 text-ink rounded-[3px]',
        'shadow-[var(--shadow-deboss)]',
        'border-b-2 border-transparent',
        'transition-[background-color,border-color] duration-150',
        'placeholder:text-ink-faint',
        'focus:shadow-[var(--shadow-raise)] focus:border-terracotta focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}
