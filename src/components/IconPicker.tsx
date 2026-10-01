/**
 * Icon picker for a category.
 *
 * A popover grid rather than a native <select>, because a native select cannot
 * show glyphs and forty names in a list is unusable on a phone. Hand-rolled for
 * the same reason the rest of the app's overlays are: a disclosure, a grid, and
 * a click-outside handler.
 *
 * The set is closed (see ./category-icons), so every tile is guaranteed to
 * render. That is also enforced server-side — an unrecognised name would be a
 * blank box in the category list, so the API rejects it rather than storing it.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Check } from 'lucide-react'

import type { CategoryIconName } from '#/lib/category-icons'
import { CATEGORY_ICONS, iconFor } from '#/lib/category-icons'
import { cn } from '#/lib/cn'

export function IconPicker({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (next: CategoryIconName) => void
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const Current = iconFor(value)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="listbox"
        title="Choose an icon"
        className="grid place-items-center size-10 rounded-[var(--radius)]
          border border-rule bg-paper-sunk text-ink-muted
          transition-[background-color,color] duration-150
          hover:text-ink hover:bg-[var(--color-paper-raised)]"
      >
        <Current size={18} aria-hidden />
      </button>

      {open && (
        <div
          id={panelId}
          role="listbox"
          aria-label="Category icon"
          className="absolute z-50 mt-1.5 left-0
            w-[min(21rem,calc(100vw-3rem))]
            rounded-[var(--radius-lg)] border border-rule
            bg-[var(--color-paper-raised)] shadow-[var(--shadow-float)]
            p-2 max-h-72 overflow-y-auto"
        >
          <ul className="grid grid-cols-6 sm:grid-cols-8 gap-1">
            {CATEGORY_ICONS.map(({ name, label, icon: Icon }) => {
              const selected = name === value
              return (
                <li key={name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={label}
                    title={label}
                    onClick={() => {
                      onChange(name)
                      setOpen(false)
                    }}
                    className={cn(
                      'grid place-items-center size-9 rounded-[var(--radius)] relative',
                      'transition-[background-color] duration-150',
                      selected
                        ? 'bg-[var(--color-terracotta)] text-[var(--color-ink)]'
                        : 'text-ink-muted hover:bg-[var(--color-paper-sunk)] hover:text-ink',
                    )}
                  >
                    <Icon size={17} aria-hidden />
                    {selected && (
                      <Check
                        size={10}
                        aria-hidden
                        className="absolute -right-0.5 -bottom-0.5 rounded-full bg-[var(--color-paper-raised)] p-[1px]"
                      />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
