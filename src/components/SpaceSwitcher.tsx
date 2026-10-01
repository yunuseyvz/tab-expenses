/**
 * Which household am I looking at?
 *
 * Needed as soon as one account holds more than one space. It writes two things
 * on switch: the `?space=` search param, so the URL is shareable and survives a
 * reload, and the remembered-space cookie, so the nav links — which carry no
 * space — land on whichever space you last actually looked at.
 *
 * Hand-rolled rather than pulled from a primitives library: a menu, a
 * disclosure, and a list. The app does the same for its sheet and its theme
 * picker.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronDown, Plus } from 'lucide-react'

import { rememberSpace } from '#/lib/auth.functions'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'
import { cn } from '#/lib/cn'
import { spaceKeys } from '#/lib/session'

export function SpaceSwitcher({ compact }: { compact?: boolean }) {
  const { spaces, space, spaceId } = useCurrentSpace()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()

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

  // A single space still gets a control: it is the only way to reach "new
  // space", and hiding it would make adding a second household undiscoverable.
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        className={cn(
          'flex items-center gap-1.5 rounded-[var(--radius)] px-2.5 py-1.5',
          'transition-[background-color] duration-150 hover:bg-[var(--color-paper-sunk)]',
          compact ? 'text-sm' : 'text-[15px]',
        )}
      >
        <span className="font-serif tracking-tight truncate max-w-[9rem]">
          {space?.name ?? 'No space'}
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

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Switch space"
          className="absolute z-50 mt-1.5 min-w-[15rem] left-0
            rounded-[var(--radius-lg)] border border-rule
            bg-[var(--color-paper-raised)] shadow-[var(--shadow-float)]"
        >
          <ul className="p-1.5">
            {spaces.map((s) => {
              const current = s.id === spaceId
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={current}
                    onClick={() => pick.mutate(s.id)}
                    className={cn(
                      'w-full flex items-center gap-2 rounded-[var(--radius)] px-2.5 py-2 text-left',
                      'transition-colors duration-150',
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
                        current
                          ? 'text-[var(--color-terracotta)]'
                          : 'opacity-0',
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{s.name}</span>
                      <span className="block text-[11px] text-ink-faint">
                        {s.currency} · {s.role === 'owner' ? 'owner' : 'member'}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="border-t border-rule p-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                void navigate({ to: '/spaces/new' })
              }}
              className="w-full flex items-center gap-2 rounded-[var(--radius)] px-2.5 py-2
                text-sm text-ink-muted transition-colors duration-150
                hover:bg-[var(--color-paper-sunk)] hover:text-ink"
            >
              <Plus size={15} aria-hidden />
              New space
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
