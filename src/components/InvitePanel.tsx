/**
 * Owner-facing invitation management.
 *
 * Two halves that have to stay in step: the form that creates an invitation, and
 * the list of the ones already sent. The list is not decoration — an invitation
 * that was mailed to a typo cannot be unsent, so being able to see and revoke
 * the pending ones is the only way to tell a mistyped address from a live one.
 *
 * Shown only to owners. Members cannot invite, which is enforced server-side by
 * requireSpaceOwner; hiding the control here is just honesty about it.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Mail, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/Button'
import { Card, CardHeader, CardTitle } from '#/components/ui/Card'
import { Input, Label } from '#/components/ui/Input'
import { createInvite, listInvites, revokeInvite } from '#/lib/invite.functions'

function relativeDay(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)
  if (days <= 0) return 'expires today'
  if (days === 1) return 'expires tomorrow'
  return `expires in ${days} days`
}

export function InvitePanel({ spaceId }: { spaceId: string }) {
  const [email, setEmail] = useState('')
  const queryClient = useQueryClient()

  const invites = useQuery({
    queryKey: ['spaces', spaceId, 'invites'],
    queryFn: () => listInvites({ data: { spaceId } }),
    enabled: !!spaceId,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['spaces', spaceId, 'invites'] })

  const invite = useMutation({
    mutationFn: () => createInvite({ data: { spaceId, email } }),
    onSuccess: (result) => {
      setEmail('')
      void invalidate()
      // A failed send is reported separately from a failed invite: the
      // invitation exists either way, and the owner needs to know which.
      if (result.emailed) {
        toast.success(`Invitation sent to ${email}`)
      } else {
        toast.error(
          'The invitation was saved but the email could not be sent. Check the server log.',
        )
      }
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Could not create the invitation',
      )
    },
  })

  const revoke = useMutation({
    mutationFn: (inviteId: string) =>
      revokeInvite({ data: { spaceId, inviteId } }),
    onSuccess: () => void invalidate(),
  })

  const rows = invites.data ?? []

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Invite people</CardTitle>
      </CardHeader>
      <p className="text-xs text-ink-faint mb-3">
        They accept it from their own account. No account? Use{' '}
        <strong>Add a virtual member</strong> instead.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          invite.mutate()
        }}
        // The label spans both controls, and the field and the button share one
        // row, rather than the label sitting inside a column beside the button.
        //
        // The old shape aligned them with `items-end`, which put the button's
        // *bottom* level with the field's bottom — and the button is 40px against
        // the field's 46px, so its top edge sat 6px lower and the pair read as
        // offset even though they were technically flush. Matching the two
        // control heights with a magic number would break the moment the field's
        // padding changed; letting the row stretch them to each other cannot.
        className="flex flex-col gap-1.5"
      >
        <Label htmlFor="invite-email" className="mb-0">
          Email address
        </Label>
        <div className="flex gap-2 items-stretch">
          <Input
            id="invite-email"
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="kai@example.com"
            className="flex-1 min-w-0"
          />
          {/* `h-auto` and `self-stretch`, in that order.
           *
           * `items-stretch` on the row does nothing to a button that carries an
           * explicit height, and every size but `link` does: md is h-10, which
           * is 40px against this field's 46px. `h-auto` drops the fixed height so
           * the row's stretch applies, and the button takes whatever height the
           * field is — which is 46px today and stays correct if the field's
           * padding ever changes, where a hard-coded h-[46px] would not. */}
          <Button
            type="submit"
            disabled={invite.isPending || !email}
            className="shrink-0 h-auto self-stretch"
          >
            {invite.isPending ? (
              <>
                <Loader2 size={15} className="animate-spin" aria-hidden />{' '}
                Sending
              </>
            ) : (
              <>
                <Mail size={15} aria-hidden /> Invite
              </>
            )}
          </Button>
        </div>
      </form>

      {rows.length > 0 && (
        <ul className="mt-4 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm min-w-0">
              <span className="min-w-0 flex-1 truncate">{r.email}</span>
              <span
                className={
                  r.status === 'pending'
                    ? 'text-xs text-ink-faint shrink-0'
                    : 'text-xs text-ink-faint shrink-0 line-through'
                }
              >
                {r.status === 'pending'
                  ? relativeDay(r.expiresAt.toString())
                  : r.status}
              </span>
              {r.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => revoke.mutate(r.id)}
                  aria-label={`Revoke the invitation for ${r.email}`}
                  className="shrink-0 p-1 text-ink-faint hover:text-oxblood-ink"
                >
                  <X size={15} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
