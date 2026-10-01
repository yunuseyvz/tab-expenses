/**
 * Which household am I looking at?
 *
 * Needed as soon as one account holds more than one space. It writes two things
 * on switch: the `?space=` search param, so the URL is shareable and survives a
 * reload, and the remembered-space cookie, so the nav links — which carry no
 * space — land on whichever space you last actually looked at.
 *
 * Two shapes, because there are two places it appears and they are mirrors of
 * each other. `panel` is the sidebar's dedicated section: a card with the
 * household's mark, its name, its currency and how many spaces the account holds,
 * so "which household am I in" is answered by the chrome rather than by reading
 * the page heading. `avatar` is the same switcher reduced to the mark, sitting
 * in the floating bottom bar where four tabs and a household's *name* do not fit
 * across a phone — the same information the sidebar leads with, first.
 *
 * A third shape used to exist: the name in the mobile top bar. It was removed
 * when the bar took over, because a phone was then showing the same household
 * twice — as a name at the top and as a mark at the bottom.
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
  variant = 'panel',
  menuSide = 'below',
}: {
  /** `panel` is the sidebar's card; `avatar` is the mark alone, in the bar. */
  variant?: 'panel' | 'avatar'
  /**
   * Which way the list opens. In the floating bottom bar the trigger is at the
   * bottom of the screen, so a menu that dropped downward would open off the
   * bottom edge — which is the one direction that cannot be scrolled to reach.
   */
  menuSide?: 'below' | 'above'
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
      menuSide={menuSide}
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

  // Keyed on the space so the editor's state dies with the dialog. Without it
  // the component stays mounted across close/reopen (it returns null rather
  // than unmounting), and the next space opened would come up pre-filled with
  // the previous one's half-typed rename — and on the delete step, with the
  // previous space's name already typed into the confirmation field.
  const editor = (
    <SpaceEditor
      key={editing?.id ?? 'none'}
      space={editing}
      onClose={() => setEditing(null)}
    />
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
        <AvatarTrigger
          space={space}
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

/**
 * The switcher as the mark alone, for the floating bar.
 *
 * The household's name is not lost by dropping it: it is in the aria-label and
 * the tooltip, and it is the first line of the menu that opens from here. Four
 * tabs plus a household's *name* does not fit across a phone, and the sidebar
 * leads with the mark anyway, so the mark alone is the same information the
 * sidebar gives first.
 */
function AvatarTrigger({
  space,
  open,
  onToggle,
}: {
  space: Space | null
  open: boolean
  onToggle: () => void
}) {
  const menuId = useId()
  const name = space?.name ?? 'No space'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={menuId}
      aria-haspopup="listbox"
      aria-label={`Space: ${name}`}
      title={name}
      className="flex items-center rounded-full px-1.5
        transition-[background-color,transform] duration-150
        hover:bg-[var(--color-paper-sunk)]
        active:scale-[0.96] motion-reduce:active:scale-100"
    >
      <Avatar
        avatarKey={space?.icon}
        seed={space?.id ?? 'none'}
        name={space?.name}
        size={30}
      />
      <ChevronDown
        size={14}
        aria-hidden
        className={cn(
          'shrink-0 -ml-0.5 text-ink-muted transition-transform duration-200',
          open && 'rotate-180',
        )}
      />
    </button>
  )
}

function SpaceMenu({
  menuSide,
  spaces,
  currentId,
  onPick,
  onNew,
  onEdit,
}: {
  menuSide: 'below' | 'above'
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
        'absolute z-50 min-w-[15rem]',
        // Opened upward from the bottom bar, downward everywhere else. `bottom-full`
        // rather than a negative margin, so the gap survives the bar's own
        // padding instead of being measured from the wrong edge.
        menuSide === 'above' ? 'bottom-full left-0 mb-1.5' : 'left-0 mt-1.5',
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
