/**
 * Editing a space, and destroying one.
 *
 * Opens from the pencil on any row of the space menu, so a household can be
 * renamed or given a mark without a trip to settings first. Owners only — the
 * pencil is not rendered for members, and the server enforces the same rule.
 *
 * Currency is shown but disabled once the space has expenses, with the reason
 * stated rather than just greyed out. The server enforces the same rule; a rule
 * the client hides silently is a rule nobody can learn.
 *
 * DELETION IS A SECOND STEP INSIDE THIS SHEET, NOT A SECOND SHEET
 * Stacking a confirm dialog on top of the editor would need a second backdrop
 * and a second z-order to reason about, and the two would fight over focus and
 * over Escape. So the sheet swaps its own contents: the edit form becomes the
 * warning, and Back puts the form back with everything still typed into it.
 *
 * The warning states counts and a total rather than saying "this cannot be
 * undone", because that sentence alone tells someone how serious it is but not
 * what they are about to lose. Typing the space's name is the last gate, and it
 * is here because the operation has no undo, no trash and no soft delete — the
 * cheapest possible undo would be not offering one.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import type { PeriodPreset } from '#/lib/period'
import { AvatarPicker } from '#/components/AvatarPicker'
import { Sheet } from '#/components/AppShell'
import { Button } from '#/components/ui/Button'
import { Input, Label, Select } from '#/components/ui/Input'
import { deleteSpace, spaceSummary, updateSpace } from '#/lib/space.functions'
import { rememberSpace } from '#/lib/auth.functions'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'
import { formatMoney } from '#/lib/money'
import { spaceKeys } from '#/lib/session'

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'PLN']

export interface EditableSpace {
  id: string
  name: string
  currency: string
  icon?: string | null
}

export function SpaceEditor({
  space,
  onClose,
}: {
  space: EditableSpace | null
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  // The second step. Kept here rather than in a route or a dialog so that
  // backing out of it cannot lose the half-typed rename above.
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { spaces, spaceId } = useCurrentSpace()
  // Read once, so landing in the next household keeps the filter you were
  // looking at. Navigating with a bare `space` would silently snap the period
  // back to this month, which reads as "the filter reset" right after a delete.
  const currentSearch = useRouterState({
    select: (s) => s.location.search as Record<string, unknown>,
  })
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

  // Serves the currency lock and the delete warning, so it is one call rather
  // than a count query plus a summary query on the same sheet.
  const summary = useQuery({
    queryKey: ['space-summary', space?.id],
    queryFn: () => spaceSummary({ data: { spaceId: space!.id } }),
    enabled: !!space,
  })

  const save = useMutation({
    mutationFn: () =>
      updateSpace({
        data: {
          spaceId: space!.id,
          name: (name || space!.name).trim(),
          icon,
          // Omitted when unchanged, so a save that only renames does not trip
          // the currency lock on a space that already has expenses.
          ...(currency && currency !== space!.currency ? { currency } : {}),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: spaceKeys.mySpaces })
      void queryClient.invalidateQueries({ queryKey: spaceKeys.all })
      toast.success('Space updated')
      onClose()
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : 'Could not update the space',
      ),
  })

  // The space is passed as a mutation variable rather than read off the prop
  // inside the callbacks. onSuccess runs after `await`s, by which time the
  // dialog can already be closed and the prop null — reading `space.name` there
  // would throw on a deletion that had in fact succeeded. The value that was
  // actually deleted is the one the mutation was called with.
  const remove = useMutation({
    mutationFn: (target: EditableSpace) =>
      deleteSpace({ data: { spaceId: target.id } }),
    onSuccess: async (_result, target) => {
      const wasCurrent = spaceId === target.id
      const remaining = spaces.filter((s) => s.id !== target.id)

      // The space list is what every screen's "which space" resolves against,
      // so it has to be refetched before anything navigates — otherwise the app
      // briefly renders a household that no longer exists.
      await queryClient.invalidateQueries({ queryKey: spaceKeys.mySpaces })
      await queryClient.invalidateQueries({ queryKey: spaceKeys.all })
      onClose()
      toast.success(`${target.name} deleted`)

      // Deleting a space you were not looking at should not move you. Only the
      // current one forces a change of scene.
      if (!wasCurrent) return

      const next = remaining[0]
      if (!next) {
        // The protected layout sends anyone with no spaces to /setup; going
        // there directly saves a render of a dashboard with nothing in it.
        void navigate({ to: '/setup' })
        return
      }

      // The cookie still names a space that no longer exists. Rewrite it, or
      // every nav link — which carry no space of their own — would land on a
      // dead id and fall through to the first space anyway.
      await rememberSpace({ data: { spaceId: next.id } })
      await queryClient.invalidateQueries({
        queryKey: spaceKeys.rememberedSpace,
      })
      void navigate({
        to: '/dashboard',
        search: {
          space: next.id,
          period: (str(currentSearch.period) ?? 'thisMonth') as PeriodPreset,
          cats: str(currentSearch.cats),
          from: str(currentSearch.from),
          to: str(currentSearch.to),
        },
      })
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : 'Could not delete the space',
      ),
  })

  if (!space) return null

  const s = summary.data
  const hasExpenses = (s?.expenses ?? 0) > 0
  // The name is the gate, so it is compared the way a person would say it:
  // trailing spaces and capitalisation are not a different household.
  const nameMatches = typed.trim().toLowerCase() === space.name.toLowerCase()

  return (
    <Sheet
      open
      onClose={onClose}
      title={confirming ? 'Delete space' : 'Edit space'}
    >
      {confirming ? (
        <div className="space-y-4 pb-4">
          <div className="rounded-[var(--radius-md)] border border-oxblood-ink/40 bg-oxblood-ink/10 p-3">
            <p className="text-sm leading-relaxed">
              <strong className="font-medium">{space.name}</strong> will be
              deleted for everyone in it. There is no undo, no trash and no copy
              kept anywhere.
            </p>
          </div>

          {s ? (
            <dl className="rounded-[var(--radius-md)] border border-rule bg-[var(--color-paper-sunk)] divide-y divide-rule">
              <Lost
                label={
                  s.expenses === 1 ? '1 expense' : `${s.expenses} expenses`
                }
                detail={
                  s.expenses > 0
                    ? formatMoney(s.totalMinor, space.currency)
                    : 'nothing recorded yet'
                }
              />
              <Lost
                label={s.members === 1 ? '1 member' : `${s.members} members`}
                detail="lose access immediately"
              />
              {s.categories > 0 && (
                <Lost
                  label={
                    s.categories === 1
                      ? '1 category'
                      : `${s.categories} categories`
                  }
                />
              )}
              {s.invites > 0 && (
                <Lost
                  label={`${s.invites} pending invite${s.invites === 1 ? '' : 's'}`}
                  detail="links stop working"
                />
              )}
            </dl>
          ) : (
            <p className="text-sm text-ink-faint">
              Counting what will be lost…
            </p>
          )}

          <div>
            {/* normal-case is load-bearing, not styling. The Label is
                uppercased, and CSS uppercase rewrites ß to SS — so without this
                the instruction reads "TYPE HAUPTSTRASSE" for a space called
                "Hauptstraße" and asks for a string the gate will never accept. */}
            <Label htmlFor="space-delete-confirm">
              Type{' '}
              <span className="font-medium text-ink normal-case">
                {space.name}
              </span>{' '}
              to confirm
            </Label>
            <Input
              id="space-delete-confirm"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nameMatches) remove.mutate(space)
              }}
              placeholder={space.name}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              variant="danger"
              disabled={!nameMatches || remove.isPending || !s}
              onClick={() => remove.mutate(space)}
              className="flex-1"
            >
              <Trash2 size={15} aria-hidden />
              {remove.isPending ? 'Deleting…' : 'Delete space'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setConfirming(false)
                setTyped('')
              }}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
          // pb-4 because this sheet has no sticky footer to supply it.
          className="space-y-4 pb-4"
        >
          <div>
            <Label htmlFor="space-edit-name">Name</Label>
            <Input
              id="space-edit-name"
              required
              maxLength={80}
              // Empty means "unchanged", so the field shows a placeholder rather
              // than being pre-filled — one less thing to keep in sync.
              value={name}
              placeholder={space.name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="space-edit-currency">Currency</Label>
            <Select
              id="space-edit-currency"
              aria-label="Currency"
              value={currency || space.currency}
              disabled={hasExpenses}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            {hasExpenses && (
              <p className="mt-1.5 text-xs text-ink-faint">
                Locked. Every amount was entered in {space.currency}, so
                relabelling the currency would restate the whole history.
              </p>
            )}
          </div>

          <div>
            <Label>Avatar</Label>
            <AvatarPicker
              value={icon ?? space.icon ?? null}
              seed={space.id}
              name={space.name}
              onChange={setIcon}
              label="Space avatar"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={save.isPending} className="flex-1">
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>

          {/* Kept below the form and out of its way: this is a decision, not
              another field, and it should not be one stray tap from Save. */}
          <div className="border-t border-rule pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(true)}
              className="text-oxblood-ink hover:bg-oxblood-ink/10"
            >
              <Trash2 size={15} aria-hidden />
              Delete space
            </Button>
            <p className="mt-1.5 text-xs text-ink-faint">
              Removes this space and everything in it, for everyone.
            </p>
          </div>
        </form>
      )}
    </Sheet>
  )
}

function Lost({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <dt className="text-sm">{label}</dt>
      <dd className="text-xs text-ink-faint text-right">{detail}</dd>
    </div>
  )
}
