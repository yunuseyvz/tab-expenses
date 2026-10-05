import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '#/lib/cn'

/**
 * The tactile button: raised at rest, pressed in on tap.
 *
 * Only `transform` and `background-color` transition. Animating box-shadow is
 * not compositor-accelerated and stutters on mid-range Android — the shadow
 * swap here is a discrete state change, not a tween.
 *
 * The press is a scale, not a 1px nudge. `active:scale-[0.97]` is the single
 * cheapest thing that makes an interface feel like it is answering back, and
 * unlike a shadow it costs nothing: it is a compositor-only property.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap',
    /*
     * The radius scale, not `rounded-full`. The pills are pills because they are
     * filter chips — small, round, and shaped like a thing you press with a
     * fingertip. A 48px Save button at the same radius stops being a button and
     * starts being a lozenge, and a row of them reads as a toy. The neumorphism
     * does not need the roundness to work; it needs the shadow pair.
     */
    'rounded-[var(--radius-control)]',
    'transition-[transform,background-color,border-color,color,box-shadow] duration-150 ease-[var(--ease-out-soft)]',
    /*
     * The press is a scale AND the shadow swapping to its inset twin. Neumorphism
     * is a tactile language and a scale alone says "this moved"; a scale plus a
     * surface that visibly sinks says "this was pressed". Both are cheap, and the
     * second is the one the rest of this design is speaking in.
     */
    'active:scale-[0.97] motion-reduce:active:scale-100',
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
        /*
         * The two neutrals are extruded from the page rather than outlined on
         * it, which is the same material the pills and chips are made of.
         *
         * Secondary KEEPS its border, and on `--rule-field` rather than
         * `--color-rule`, which is a real find. The two look interchangeable and
         * are not: `--color-rule` is the hairline between rows, and in light it
         * is 0.875 — which against a button is not an edge. `--rule-field` is the
         * one tuned to clear 1.4.11's 3:1 against all three paper surfaces, which
         * is exactly the job this border is doing.
         *
         * Ghost takes no border, because it is an icon control sitting inside a
         * surface that already separates it and the tonal step does the work.
         */
        secondary:
          'neo neo-press text-ink border border-[color:var(--rule-field)] hover:border-terracotta-ink hover:text-ink',
        ghost: 'neo-sm neo-sm-press text-ink-muted hover:text-ink',
        // A per-theme token, not oxblood-ink: that is a text colour, and on
        // dark paper it is a light step, so white on it fails (2.6:1).
        danger: 'bg-[var(--color-danger-fill)] text-white hover:brightness-110',
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
        /*
         * The press, for the two filled variants. The neutrals carry their own —
         * `.neo-press` sinks them into the page, which is the neumorphic way to
         * say "pushed" and the reason this material has a tactile language at all.
         *
         * A filled control cannot sink into a page it is a different colour from,
         * so it does what a filled control has always done here: one pixel lower,
         * and its own shadow collapsing to a single inset. Both are physical
         * rather than chromatic, which is why neither costs a repaint.
         */
        variant === 'primary' || variant === 'danger'
          ? 'shadow-[var(--shadow-raise)] active:shadow-[var(--shadow-press)] active:translate-y-px'
          : '',
        className,
      )}
      {...props}
    />
  )
}

export { buttonVariants }
