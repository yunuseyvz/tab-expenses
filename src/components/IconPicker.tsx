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
import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'

import type { CategoryIconName } from '#/lib/category-icons'
import { CATEGORY_ICONS, iconFor } from '#/lib/category-icons'
import { usePopoverPlacement } from '#/hooks/usePopoverPlacement'
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
  const panelId = useId()
  const Current = iconFor(value)

  // Both axes, via the floating (viewport) placement rather than the offset one.
  //
  // The offset mode only clamps horizontally. That fixed the reported bug — the
  // grid ran out through the right of its container — but the panel still opened
  // downward from wherever the trigger happened to be, so near the bottom of a
  // settings page it opened off the bottom of the screen instead. `floating`
  // measures the panel and flips it above the trigger when there is more room
  // there, which is the case this is nearly always in: the picker sits at the end
  // of a form.
  //
  // Viewport coordinates also mean the panel can be portalled to <body>, which it
  // has to be — a `position: absolute` panel is clipped by any ancestor that
  // scrolls or hides overflow, and the settings page does both.
  const {
    anchor: root,
    panel,
    panelEl,
    floating,
  } = usePopoverPlacement<HTMLDivElement>({
    open,
    width: 22 * 16,
  })

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      // Both, because the panel is not a descendant of `root` any more. Testing
      // `root` alone would close the panel the instant a tile was clicked, and
      // the icon would never change.
      if (!root.current?.contains(target) && !panelEl?.contains(target)) {
        setOpen(false)
      }
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
  }, [open, panelEl])

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
        // Deliberately the same padding, border, radius and shadow as Input
        // rather than a fixed size. `size-10` pinned this to 40px while the
        // field beside it is 42px, and the two sat visibly out of line. Sharing
        // the field's own values makes them match by construction — if Input's
        // padding ever changes, this follows.
        // h-full, because the flex item in this row is the picker's own wrapper
        // div rather than the button. Without it the button takes its own
        // content height — the 18px icon plus padding — and sits 6px shorter
        // than the field it is paired with.
        //
        // No horizontal padding. It was px-3.5 to match Input, but that left a
        // 12px content box inside a 40px button, and a grid column sizes to
        // max-content and overflows rather than shrinking — so the icon centred
        // in a column starting at the padding edge and sat 4px right of the
        // button's centre. The padding bought nothing on a square control with
        // no text in it.
        className="grid place-items-center shrink-0 w-10 h-full
          rounded-[var(--radius-md)]
          py-2.5
          bg-paper-sunk text-ink-muted
          border border-rule/70
          shadow-[var(--shadow-deboss)]
          transition-[background-color,border-color,color,box-shadow] duration-150
          hover:text-ink hover:bg-[var(--color-paper-raised)]
          hover:border-terracotta/50
          focus-visible:outline-none focus-visible:border-terracotta
          focus-visible:bg-[var(--color-paper-raised)]"
      >
        <Current size={18} aria-hidden />
      </button>

      {/*
        Portalled to <body> as `fixed`, and only once measured: createPortal needs
        a document (this renders on the server), and `floating` is null until the
        layout pass has both the anchor's rect and the panel's own height. Until
        then nothing renders, which costs no visible latency because the panel is
        opening anyway and the measurement happens before paint.
      */}
      {open &&
        floating &&
        createPortal(
          <div
            id={panelId}
            role="listbox"
            aria-label="Category icon"
            ref={panel}
            style={{
              left: floating.left,
              top: floating.top,
              width: floating.width,
            }}
            className="fixed z-[60]
              rounded-[var(--radius-lg)] border border-rule
              bg-[var(--color-paper-raised)] shadow-[var(--shadow-float)]
              p-2 max-h-72 overflow-y-auto"
          >
            {/*
              auto-fill rather than a fixed column count: the grid fills whatever
              width was measured for it, so it can never decide the panel's width
              and then overflow it. `sm:grid-cols-8` was the other half of the
              original bug — eight 36px columns in a panel narrower than that,
              which is what put the grid through the container.
            */}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1">
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
          </div>,
          document.body,
        )}
    </div>
  )
}
