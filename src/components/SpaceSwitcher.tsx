/**
 * Which household am I looking at?
 *
 * Needed as soon as one account holds more than one space. It writes two things
 * on switch: the `?space=` search param, so the URL is shareable and survives a
 * reload, and the remembered-space cookie, so the nav links — which carry no
 * space — land on whichever space you last actually looked at.
 *
 * Two shapes. `panel` is the sidebar's dedicated section: a card with the
 * household's initial, its currency and how many spaces the account holds, so
 * "which household am I in" is answered by the chrome rather than by reading the
 * page heading. `compact` is the mobile top bar, where there is only room for a
 * name and a chevron.
 *
 * Hand-rolled rather than pulled from a primitives library: a disclosure, a
 * list, and a click-outside handler.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronDown, Pencil, Plus } from 'lucide-react'

import type { EditableSpace } from '#/components/SpaceEditor'
import { rememberSpace } from '#/lib/auth.functions'
import { SpaceEditor } from '#/components/SpaceEditor'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'
import { Avatar } from '#/components/Avatar'
import { cn } from '#/lib/cn'
import { spaceKeys } from '#/lib/session'

type Space = ReturnType<typeof useCurrentSpace>['spaces'][number]

export function SpaceSwitcher({
  compact,
  variant = 'compact',
}: {
  compact?: boolean
  variant?: 'compact' | 'panel'
}) {
  const { spaces, space, spaceId } = useCurrentSpace()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<EditableSpace | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // Dismiss on an outside click or Escape. A menu that traps you open is worse
  // than no menu, and this one is reachable with the keyboard alone.
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

  const pick = useMutation({
    mutationFn: (id: string) => rememberSpace({ data: { spaceId: id } }),
    onSuccess: async (_, id) => {
      setOpen(false)
      // Both writes are needed. The cookie decides where the *nav links* go; the
      // param makes the current screen show the choice immediately without
      // waiting for a refetch.
      await queryClient.invalidateQueries({
        queryKey: spaceKeys.rememberedSpace,
      })
      await navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, space: id }),
      })
    },
  })

  const newSpace = () => {
    setOpen(false)
    void navigate({ to: '/spaces/new' })
  }

  const menu = (
    <SpaceMenu
      spaces={spaces}
      currentId={spaceId}
      onPick={(id) => pick.mutate(id)}
      onNew={newSpace}
      onEdit={(s) => {
        setOpen(false)
        setEditing(s)
      }}
    />
  )

  const editor = (
    <SpaceEditor space={editing} onClose={() => setEditing(null)} />
  )

  // A single space still gets a control: it is the only way to reach
  // "new space", and hiding it would make adding a second household
  // undiscoverable.
  //
  // Both variants render the same menu and the same editor. They used to branch
  // early, and the panel branch returned before the editor was created — so the
  // edit pencil in the sidebar silently did nothing while the same control in
  // the mobile top bar worked. `editing` is set either way; only the dialog was
  // missing. One return, one menu, one editor.
  return (
    <div ref={root} className="relative">
      {variant === 'panel' ? (
        <PanelTrigger
          space={space}
          count={spaces.length}
          open={open}
          onToggle={() => setOpen((o) => !o)}
        />
      ) : (
        <CompactTrigger
          name={space?.name ?? 'No space'}
          compact={compact}
          open={open}
          onToggle={() => setOpen((o) => !o)}
        />
      )}
      {open && menu}
      {editor}
    </div>
  )
}

function PanelTrigger({
  space,
  count,
  open,
  onToggle,
}: {
  space: Space | null
  count: number
  open: boolean
  onToggle: () => void
}) {
  const menuId = useId()
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={menuId}
      aria-haspopup="listbox"
      className={cn(
        'w-full flex items-center gap-2.5 text-left p-2',
        'rounded-[var(--radius-md)] bg-[var(--color-paper-sunk)]',
        'shadow-[var(--shadow-deboss)]',
        'transition-[background-color,box-shadow] duration-150',
        'hover:bg-[var(--color-paper-raised)] active:scale-[0.99]',
        'motion-reduce:active:scale-100',
      )}
    >
      {/* The household's own avatar: a chosen icon, or a generated mark. */}
      <Avatar
        avatarKey={space?.icon}
        seed={space?.id ?? 'none'}
        name={space?.name}
        size={32}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-tight">
          {space?.name ?? 'No space'}
        </span>
        <span className="block truncate text-[11px] text-ink-faint leading-tight">
          {space?.currency ?? '—'}
          {count > 1 && ` · ${count} spaces`}
        </span>
      </span>
      <ChevronDown
        size={16}
        aria-hidden
        className={cn(
          'shrink-0 text-ink-muted transition-transform duration-200',
          open && 'rotate-180',
        )}
      />
    </button>
  )
}

function CompactTrigger({
  name,
  compact,
  open,
  onToggle,
}: {
  name: string
  compact?: boolean
  open: boolean
  onToggle: () => void
}) {
  const menuId = useId()
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={menuId}
      aria-haspopup="listbox"
      className={cn(
        'flex items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 py-1.5',
        'transition-[background-color] duration-150 hover:bg-[var(--color-paper-sunk)]',
        compact ? 'text-sm' : 'text-[15px]',
      )}
    >
      <span className="font-serif tracking-tight truncate max-w-[9rem]">
        {name}
      </span>
      <ChevronDown
        size={15}
        aria-hidden
        className={cn(
          'text-ink-muted transition-transform duration-200',
          open && 'rotate-180',
        )}
      />
    </button>
  )
}

function SpaceMenu({
  spaces,
  currentId,
  onPick,
  onNew,
  onEdit,
}: {
  spaces: Array<Space>
  currentId: string | null
  onPick: (id: string) => void
  onNew: () => void
  onEdit: (space: EditableSpace) => void
}) {
  const menuId = useId()
  return (
    <div
      id={menuId}
      role="listbox"
      aria-label="Switch space"
      className={cn(
        'absolute z-50 mt-1.5 min-w-[15rem]',
        // In the sidebar the trigger is full-width, so the menu hangs off its
        // left edge; in the top bar it should stay inside the viewport instead.
        'left-0',
        'rounded-[var(--radius-md)] border border-rule',
        'bg-[var(--color-paper-raised)] p-1 shadow-[var(--shadow-float)]',
      )}
    >
      <ul>
        {spaces.map((s) => {
          const current = s.id === currentId
          return (
            // Flex, so the row button and its pencil sit side by side. As a
            // plain block the pencil wrapped onto its own line, which read as a
            // stray icon rather than as a control belonging to that household.
            <li key={s.id} className="flex items-center gap-1">
              <button
                type="button"
                role="option"
                aria-selected={current}
                onClick={() => onPick(s.id)}
                className={cn(
                  'min-w-0 flex-1 flex items-center gap-2 rounded-[var(--radius-sm)]',
                  'px-2.5 py-2 text-left transition-colors duration-150',
                  current
                    ? 'bg-[var(--color-paper-sunk)]'
                    : 'hover:bg-[var(--color-paper-sunk)]',
                )}
              >
                {/* A shape marker as well as a colour one. */}
                <Check
                  size={15}
                  aria-hidden
                  className={cn(
                    'shrink-0',
                    current ? 'text-[var(--color-terracotta)]' : 'opacity-0',
                  )}
                />
                <Avatar
                  avatarKey={s.icon}
                  seed={s.id}
                  name={s.name}
                  size={28}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{s.name}</span>
                  <span className="block text-[11px] text-ink-faint">
                    {s.currency} · {s.role === 'owner' ? 'owner' : 'member'}
                  </span>
                </span>
              </button>

              {/* Separate control, not part of the row button: nesting a button
                  inside a button is invalid HTML and makes the row's hit area
                  ambiguous. Only owners can rename a space, so it is not shown
                  to members. */}
              {s.role === 'owner' && (
                <button
                  type="button"
                  onClick={() => onEdit(s)}
                  aria-label={`Edit ${s.name}`}
                  title={`Edit ${s.name}`}
                  className="shrink-0 grid place-items-center size-7 rounded-full
                    text-ink-faint transition-[color,background-color] duration-150
                    hover:text-ink hover:bg-[var(--color-paper-raised)]"
                >
                  <Pencil size={14} aria-hidden />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <div className="border-t border-rule mt-1 pt-1">
        <button
          type="button"
          onClick={onNew}
          className="w-full flex items-center gap-2 rounded-[var(--radius-sm)]
            px-2.5 py-2 text-sm text-ink-muted
            transition-colors duration-150
            hover:bg-[var(--color-paper-sunk)] hover:text-ink"
        >
          <Plus size={15} aria-hidden />
          New space
        </button>
      </div>
    </div>
  )
}
