import type { Category } from '#/lib/db/schema'
import { cn } from '#/lib/cn'
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
  categories: Array<Pick<Category, 'id' | 'name' | 'color'>>
  allIds: Array<string>
  selected: Array<string> | undefined
  onChange: (next: Array<string> | undefined) => void
}) {
  if (categories.length === 0) return null

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
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              aria-pressed={on}
              className={cn(
                'inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 text-sm',
                'rounded-[3px] border-l-4 transition-[background-color,box-shadow,border-width] duration-150',
                on
                  ? 'bg-paper-raised text-ink shadow-[var(--shadow-raise)]'
                  : 'bg-paper-sunk text-ink-muted shadow-[var(--shadow-deboss)]',
              )}
              style={{
                borderLeftColor: swatchColor(c.color),
                borderLeftWidth: on ? 4 : 2,
              }}
            >
              {on && (
                <span aria-hidden className="text-[10px] leading-none">
                  ✓
                </span>
              )}
              {c.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
