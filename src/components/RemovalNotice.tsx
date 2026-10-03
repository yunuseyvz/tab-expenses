/**
 * "You were removed from <household>".
 *
 * Shown on the next sign-in, once, and only because somebody else did it. Before
 * this existed, being removed had no consequence you could see: your space
 * vanished from the switcher, every screen you had bookmarked became a redirect,
 * and nothing anywhere said who had done it or where the ledger had gone. That is
 * the worst version of this event — you find out by hitting a dead route.
 *
 * So the notice is not a nicety, it is the only account of the event anybody
 * gets. It says which household, because "you were removed from somewhere" would
 * leave you guessing between the two you belong to. It does not say who, because
 * the app has no honest basis for it: `space_member.invited_by_user_id` is the
 * inviter and is frequently null, and naming whoever clicked the button in the
 * roster is not the same person as whoever pressed remove. Inventing a culprit
 * would be worse than omitting one.
 *
 * Mounted in both the protected layout and /setup, because being removed from
 * your only household drops you to zero spaces and therefore out of the protected
 * layout entirely — which is exactly the moment the notice matters most.
 *
 * Dismissal acknowledges rather than deletes. The row has to survive for the
 * splits that reference it; `removal_ack_at` is what stops the notice coming back
 * on the next reload, and it lives on the row so it follows the person to another
 * device.
 */
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Sheet } from '#/components/AppShell'
import { Button } from '#/components/ui/Button'
import { ackRemovalNotices, listRemovalNotices } from '#/lib/space.functions'
import { spaceKeys } from '#/lib/session'

export function RemovalNotice() {
  const queryClient = useQueryClient()
  const notices = useQuery({
    queryKey: ['removal-notices'],
    queryFn: () => listRemovalNotices(),
  })

  const ack = useMutation({
    mutationFn: () => ackRemovalNotices(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['removal-notices'] })
      // The space list is what actually changed underneath: the household is
      // gone from it now, and any screen keyed to it is rendering a space this
      // person is no longer in.
      void queryClient.invalidateQueries({ queryKey: spaceKeys.mySpaces })
    },
  })

  const pending = notices.data ?? []

  // Acknowledge on unmount as well as on the button, so navigating away clears
  // it rather than re-showing it on the next screen. Without this, closing with
  // Escape or the backdrop would leave the notice queued forever.
  //
  // The dependency is the count rather than the mutation, on purpose: this runs
  // on unmount, and including `ack` would tear down and re-register on every
  // render of the hook, which is not what "on unmount" means.
  const shouldAck = pending.length > 0
  useEffect(() => {
    if (!shouldAck) return
    return () => {
      void ack.mutate()
    }
  }, [shouldAck])

  if (pending.length === 0) return null

  const many = pending.length > 1

  return (
    <Sheet
      open
      onClose={() => ack.mutate()}
      title={
        many ? `Removed from ${pending.length} households` : 'You were removed'
      }
    >
      <div className="pb-4 space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          {many
            ? 'An owner took you off these households:'
            : 'An owner of the household took you off its roster.'}
        </p>

        <ul className="text-sm rounded-[var(--radius-md)] border border-rule bg-[var(--color-paper-sunk)] p-3 space-y-1.5">
          {pending.map((n) => (
            <li key={n.spaceId} className="font-medium text-ink truncate">
              {n.spaceName}
            </li>
          ))}
        </ul>

        {/*
          The half that matters, and the reason this dialog exists at all. Their
          name stays on every expense they entered or were included in — the
          splits reference the roster row, which archiving deliberately keeps.
          Someone removed from a household can reasonably expect their history to
          have vanished, and it has not.
        */}
        <p className="text-xs leading-relaxed text-ink-faint">
          You cannot see the household any more. Expenses you were part of keep
          your name on them.
        </p>

        <div className="flex pt-1">
          <Button
            type="button"
            size="lg"
            variant="secondary"
            className="flex-1"
            disabled={ack.isPending}
            onClick={() => ack.mutate()}
          >
            {ack.isPending ? 'Leaving…' : 'Understood'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
