import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '#/lib/cn'

/**
 * The tactile button: raised at rest, drops 1px into the paper on press.
 *
 * Only `transform` and `background-color` transition. Animating box-shadow is
 * not compositor-accelerated and stutters on mid-range Android — the shadow
 * swap here is a discrete state change, not a tween.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap',
    'transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out-soft)]',
    'disabled:pointer-events-none disabled:opacity-50',
    'select-none',
  ],
  {
    variants: {
      variant: {
        // The label is ink, not white: on a warm saturated fill white manages
        // 1.7:1 at the plan's terracotta, and even at the corrected 0.68 fill
        // it is 2.6:1. Ink on the same fill is 4.8:1 and reads as ink on paper,
        // which is the art direction anyway.
        //
        // Hover lightens rather than darkens, because darkening a light fill
        // drops the label straight back under 4.5:1. The pressed state is
        // carried by the transform and the inset shadow instead.
        primary: 'bg-terracotta text-ink hover:bg-terracotta-strong',
        secondary:
          'bg-transparent text-ink border border-rule hover:border-terracotta-ink',
        ghost: 'bg-transparent text-ink-muted hover:text-ink',
        danger: 'bg-oxblood-ink text-white hover:brightness-110',
        link: 'bg-transparent text-terracotta-ink underline underline-offset-4 p-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants>

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant ?? 'primary'}
      data-size={size ?? 'md'}
      className={cn(
        buttonVariants({ variant, size }),
        // Pressed state is physical: 1px lower and flatter.
        'active:translate-y-px',
        variant === 'primary' || variant === 'danger'
          ? 'shadow-[var(--shadow-raise)] active:shadow-[var(--shadow-press)]'
          : '',
        className,
      )}
      {...props}
    />
  )
}

export { buttonVariants }
