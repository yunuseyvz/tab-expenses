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
 * A list row: flat, separated by hairlines, like ruled paper. Rows are not
 * individually shadowed — nesting shadows inside shadows is how a skeuomorphic
 * UI starts to look cheap.
 *
 * Hover does NOT move the row. It used to raise it a pixel, and on the balances
 * screen — where a member list and a settle-up list sit directly above each other
 * — that pixel was worse than no feedback at all: the row visibly jumped away
 * from the hairline under it while you were trying to read which of two adjacent
 * numbers it belonged to. A list that moves when you point at it is a list you
 * point at more than once.
 */
export function Row({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 py-3 border-b border-rule last:border-b-0',
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
