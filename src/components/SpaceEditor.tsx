/**
 * Editing a space.
 *
 * Opens from the pencil on any row of the space menu, so a household can be
 * renamed or given a mark without a trip to settings first.
 *
 * Currency is shown but disabled once the space has expenses, with the reason
 * stated rather than just greyed out. The server enforces the same rule; a rule
 * the client hides silently is a rule nobody can learn.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { AvatarPicker } from '#/components/AvatarPicker'
import { Sheet } from '#/components/AppShell'
import { Button } from '#/components/ui/Button'
import { Input, Label, Select } from '#/components/ui/Input'
import { spaceHasExpenses, updateSpace } from '#/lib/space.functions'
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
  const queryClient = useQueryClient()

  const hasExpenses = useQuery({
    queryKey: ['space-has-expenses', space?.id],
    queryFn: () => spaceHasExpenses({ data: { spaceId: space!.id } }),
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

  if (!space) return null

  return (
    <Sheet open onClose={onClose} title="Edit space">
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
            disabled={hasExpenses.data === true}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          {hasExpenses.data === true && (
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
      </form>
    </Sheet>
  )
}
