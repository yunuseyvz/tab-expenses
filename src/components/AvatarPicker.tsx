import { useEffect, useId, useRef, useState } from 'react'
import { Check } from 'lucide-react'

import { AVATAR_ICONS, avatarLabel, isAvatarIcon } from '#/lib/avatars'
import { Avatar } from '#/components/Avatar'
import { cn } from '#/lib/cn'

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
 */
export function AvatarPicker({
  value,
  seed,
  name,
  onChange,
  label = 'Avatar',
  id,
}: {
  value: string | null
  /** Stable id for the generated option — never a display name. */
  seed: string
  name?: string
  onChange: (next: string | null) => void
  label?: string
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()

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

  const current = value ?? null
  const isGenerated = !current || !isAvatarIcon(current)

  return (
    <div ref={root} className="relative">
      <button
        id={id}
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
        <Avatar avatarKey={current} seed={seed} name={name} size={44} />
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-medium truncate">{name}</span>
          <span className="block text-xs text-ink-faint truncate">
            {isGenerated ? 'Generated' : avatarLabel(current)}
          </span>
        </span>
        <span className="text-xs text-ink-muted shrink-0">Change</span>
      </button>

      {open && (
        <div
          id={panelId}
          role="listbox"
          aria-label={label}
          className="absolute z-50 mt-1.5 left-0 right-0 z-50
            max-h-72 overflow-y-auto overscroll-contain
            rounded-[var(--radius-md)] border border-rule
            bg-[var(--color-paper-raised)] p-2
            shadow-[var(--shadow-float)]"
        >
          <div className="flex items-center gap-2 px-1 pb-2">
            <GeneratedOption
              active={current === null}
              seed={seed}
              onPick={() => {
                onChange(null)
                setOpen(false)
              }}
            />
            <span className="text-[11px] text-ink-faint">
              Pick one, or keep the generated mark
            </span>
          </div>

          <ul className="grid grid-cols-8 gap-1 border-t border-rule pt-2">
            {AVATAR_ICONS.map(({ name: key, label: iconLabel, icon: Icon }) => {
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
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/** The "no choice" option: the identicon derived from the id. */
function GeneratedOption({
  active,
  seed,
  onPick,
}: {
  active: boolean
  seed: string
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
      <Avatar avatarKey={null} seed={seed} size={30} />
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
