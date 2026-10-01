import type { ComponentProps } from 'react'

import { cn } from '#/lib/cn'

/** A card sitting on the paper: raised, warm, square-ish corners. */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('card p-4', className)} {...props} />
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 mb-3 pb-2 border-b border-rule',
        className,
      )}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      className={cn('text-sm font-semibold tracking-wide text-ink', className)}
      {...props}
    />
  )
}

/**
 * A list row: flat, separated by hairlines, like ruled paper. Hover raises it
 * 1px. Rows are not individually shadowed — nesting shadows inside shadows is
 * how a skeuomorphic UI starts to look cheap.
 */
export function Row({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 py-3 border-b border-rule last:border-b-0',
        'transition-transform duration-150 hover:translate-y-px',
        className,
      )}
      {...props}
    />
  )
}

/** Section heading in the editorial/typographic voice of the Sera base style. */
export function SectionTitle({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      className={cn(
        'text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint',
        className,
      )}
      {...props}
    />
  )
}
