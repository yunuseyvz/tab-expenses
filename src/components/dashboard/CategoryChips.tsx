import { Check } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

import type { Category } from '#/lib/db/schema'
import { cn } from '#/lib/cn'
import { iconFor } from '#/lib/category-icons'
import { swatchColor } from '#/lib/swatches'

/**
 * The category filter — the "checkbox" idea.
 *
 * Selected chips also change border weight and gain a check glyph, so state is
 * never encoded in colour alone (a requirement for accessibility, and the
 * place skeuomorphic UIs usually fail).
 */
export function CategoryChips({
  categories,
  allIds,
  selected,
  onChange,
}: {
  categories: Array<Pick<Category, 'id' | 'name' | 'color' | 'icon'>>
  allIds: Array<string>
  selected: Array<string> | undefined
  onChange: (next: Array<string> | undefined) => void
}) {
  if (categories.length === 0) return null

  // Read once, here: the check's spring is the only motion on this screen and it
  // has to be able to arrive without travelling.
  const reduceMotion = useReducedMotion()

  const isAll = selected === undefined || selected.length === allIds.length
  const isNone = selected !== undefined && selected.length === 0

  const toggle = (id: string) => {
    const current = selected ?? allIds
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id]
    onChange(next)
  }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
          Categories
        </h2>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => onChange(undefined)}
            disabled={isAll}
            className="text-terracotta-ink underline underline-offset-2 disabled:text-ink-faint disabled:no-underline"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={isNone}
            className="text-terracotta-ink underline underline-offset-2 disabled:text-ink-faint disabled:no-underline"
          >
            None
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map((c) => {
          const on = selected === undefined || selected.includes(c.id)
          const Icon = iconFor(c.icon)
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              aria-pressed={on}
              className={cn(
                'inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 text-sm',
                'rounded-full border-l-4',
                'transition-[background-color,box-shadow,border-width,color] duration-150',
                /*
                 * Same inversion as the period pills: chosen is pressed into the
                 * page, unchosen stands proud of it. The category's colour is on
                 * the left edge either way, which is what identifies the chip —
                 * a 2px rule versus a 4px one is too small a difference to be
                 * doing that work on its own.
                 */
                on
                  ? 'neo-inset text-ink font-medium'
                  : 'neo neo-press text-ink-muted hover:text-ink',
              )}
              style={{
                borderLeftColor: swatchColor(c.color),
                borderLeftWidth: on ? 4 : 2,
              }}
            >
              {/*
                The glyph is animated rather than swapped, and it is the one piece
                of motion on this screen that earns its place: a check that
                appears at full size is a fact, and a check that springs up out of
                the chip says the chip did something. It is a spring on scale and
                opacity only — no layout, no width, nothing for the row to reflow
                around, which on a wrapping row of chips is the difference between
                a flourish and a jiggle.

                Reduced motion gets the same end state with no travel, rather than
                a different end state: the chip still says selected, it just
                arrives rather than springs.
              */}
              <span className="relative grid size-[13px] shrink-0 place-items-center">
                <Icon
                  size={13}
                  aria-hidden
                  className={cn(
                    'shrink-0',
                    on ? 'opacity-0' : 'opacity-70',
                    reduceMotion ? '' : 'transition-opacity duration-150',
                  )}
                />
                <motion.span
                  aria-hidden
                  className="absolute inset-0 grid place-items-center"
                  initial={false}
                  animate={
                    on
                      ? { scale: 1, opacity: 1 }
                      : { scale: reduceMotion ? 1 : 0.5, opacity: 0 }
                  }
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : {
                          type: 'spring',
                          stiffness: 520,
                          damping: 26,
                          mass: 0.7,
                        }
                  }
                >
                  <Check size={13} />
                </motion.span>
              </span>
              <span className="truncate">{c.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
