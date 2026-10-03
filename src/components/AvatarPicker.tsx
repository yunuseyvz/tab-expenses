import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'

import type { AvatarKind } from '#/lib/avatars'
import { AVATAR_GROUPS, avatarLabel, isAvatarIcon } from '#/lib/avatars'
import { usePopoverPlacement } from '#/hooks/usePopoverPlacement'
import { Avatar } from '#/components/Avatar'
import { cn } from '#/lib/cn'

/** Wide enough for eight icon columns plus their gaps. */
const PANEL_WIDTH = 384

/**
 * Choose an avatar.
 *
 * `null` is a real option and is listed first: it means "generate one from my id",
 * which is the better default for most people — two household members can never
 * collide, and nothing has to be chosen or maintained.
 *
 * No upload, deliberately. There is no storage, no size limit, no moderation and
 * nothing to serve; and the alternative would mean either hosting images the app
 * never asked for or fetching them from someone else's server on every render.
 *
 * PORTALLED TO THE BODY, and that is a fix rather than a flourish. This picker
 * is used inside the space editor's sheet, whose body scrolls and whose frame is
 * `overflow-hidden`. A panel positioned `absolute` inside that is clipped by the
 * scroller — so the bottom two rows of icons were unreachable — and it is also
 * the reason the panel appeared to be *inside* the form, pushing the save button
 * down. Portalled to <body> as `fixed`, it is over everything: the sheet, the
 * backdrop, and the fields it was opened from.
 */
export function AvatarPicker({
  value,
  seed,
  name,
  onChange,
  label = 'Avatar',
  id,
  kind = 'person',
}: {
  value: string | null
  /** Stable id for the generated option — never a display name. */
  seed: string
  name?: string
  onChange: (next: string | null) => void
  label?: string
  id?: string
  /** Passed through so the preview matches what the app will actually draw. */
  kind?: AvatarKind
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const { anchor, panel, floating } = usePopoverPlacement<HTMLButtonElement>({
    open,
    width: PANEL_WIDTH,
  })

  // The hook needs the panel element to measure it; the outside-click handler
  // needs it to know a click landed inside it. One callback, both jobs.
  const setPanel = useCallback(
    (el: HTMLDivElement | null) => {
      panelRef.current = el
      panel(el)
    },
    [panel],
  )

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      // Both, because the panel is no longer inside `root` — it is on <body>.
      // Checking only the trigger would close the picker on every click inside
      // it, so no icon could ever be chosen.
      if (!root.current?.contains(t) && !panelRef.current?.contains(t)) {
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
  }, [open])

  const current = value ?? null
  const isGenerated = !current || !isAvatarIcon(current)

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="listbox"
        className={cn(
          'flex items-center gap-3 rounded-[var(--radius-md)] p-2 w-full',
          'border border-rule/70 bg-paper-sunk',
          'transition-[background-color,border-color,box-shadow] duration-150',
          'hover:bg-[var(--color-paper-raised)]',
        )}
      >
        <Avatar
          avatarKey={current}
          seed={seed}
          name={name}
          kind={kind}
          size={44}
        />
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-medium truncate">{name}</span>
          <span className="block text-xs text-ink-faint truncate">
            {isGenerated ? 'Generated' : avatarLabel(current)}
          </span>
        </span>
        <span className="text-xs text-ink-muted shrink-0">Change</span>
      </button>

      {/* On <body>, not here. See the note on the component: inside the space
          editor's sheet this panel was clipped by the scroller, so the last rows
          of icons could not be reached at all. `z-[60]` clears the sheet's own
          z-50 and its z-40 backdrop. Positioned from `floating`, which is
          viewport coordinates — it flips above the trigger when there is not
          room below, and it is only rendered once measured so it never paints
          in the wrong place first. */}
      {open &&
        floating &&
        createPortal(
          <div
            ref={setPanel}
            id={panelId}
            role="listbox"
            aria-label={label}
            style={{
              left: floating.left,
              top: floating.top,
              width: floating.width,
            }}
            className="fixed z-[60] max-h-[min(22rem,70dvh)] overflow-y-auto
              overscroll-contain rounded-[var(--radius-md)] border border-rule
              bg-[var(--color-paper-raised)] p-2 shadow-[var(--shadow-float)]"
          >
            <div className="flex items-center gap-2 px-1 pb-2">
              <GeneratedOption
                active={current === null}
                seed={seed}
                kind={kind}
                onPick={() => {
                  onChange(null)
                  setOpen(false)
                }}
              />
              <span className="text-[11px] text-ink-faint">
                Pick one, or keep the generated mark
              </span>
            </div>

            {/*
              Grouped rather than one long grid. There are a hundred-odd icons
              now, and an undifferentiated wall of them is a scanning exercise
              rather than a choice. Headings also make the panel navigable by
              reading order rather than by hunting — and `role="group"` with a
              label per group means a screen reader announces which section a
              tile is in.
            */}
            {AVATAR_GROUPS.map((g, gi) => (
              <div
                key={g.group}
                role="group"
                aria-label={g.group}
                className={gi === 0 ? 'border-t border-rule pt-2' : 'pt-3'}
              >
                <h3 className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                  {g.group}
                </h3>
                <ul className="grid grid-cols-8 gap-1">
                  {g.icons.map(
                    ({ name: key, label: iconLabel, icon: Icon }) => {
                      const selected = current === key
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            aria-label={iconLabel}
                            title={iconLabel}
                            onClick={() => {
                              onChange(key)
                              setOpen(false)
                            }}
                            className={cn(
                              'relative grid place-items-center size-9 rounded-[var(--radius-sm)]',
                              'text-ink-muted transition-[background-color,color] duration-150',
                              'hover:bg-[var(--color-paper-sunk)] hover:text-ink',
                              selected &&
                                'bg-[var(--color-terracotta)] text-[var(--color-ink)]',
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
                    },
                  )}
                </ul>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

/** The "no choice" option: the identicon derived from the id. */
function GeneratedOption({
  active,
  seed,
  kind,
  onPick,
}: {
  active: boolean
  seed: string
  kind: AvatarKind
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      className={cn(
        'relative grid place-items-center size-11 shrink-0 rounded-[var(--radius-sm)]',
        'transition-[background-color] duration-150',
        active
          ? 'ring-2 ring-[var(--color-terracotta)] ring-offset-1 ring-offset-[var(--color-paper-raised)]'
          : 'hover:bg-[var(--color-paper-sunk)]',
      )}
    >
      <Avatar avatarKey={null} seed={seed} kind={kind} size={30} />
      {active && (
        <Check
          size={10}
          aria-hidden
          className="absolute -right-0.5 -bottom-0.5 rounded-full bg-[var(--color-paper-raised)] p-[1px]"
        />
      )}
    </button>
  )
}
