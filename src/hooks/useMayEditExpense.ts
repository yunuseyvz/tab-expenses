/**
 * Whether the signed-in user may change an expense, and why not if they may not.
 *
 * Every screen with a tap-to-edit expense row needs the same answer. The server
 * already decides — see `assertMayEdit` in expense.functions — and this hook is
 * only the UI half: it decides whether to offer the affordance or to say why
 * there isn't one, so a member does not tap a row and get a rejection toast.
 *
 * Built from queries the routes already hold (session, members, spaces) so it
 * costs nothing extra. Any of them can be briefly absent during a re-render, in
 * which case the answer is "cannot edit": the row stays inert for a frame and
 * then becomes editable, which is the right way round to fail.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { MemberListItem } from '#/lib/space.functions'
import type { ExpenseRow } from '#/lib/expense.functions'
import { getSession } from '#/lib/auth.functions'
import { editBlockedReason } from '#/lib/may-edit'
import { membersQuery } from '#/lib/session'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'

export function useMayEditExpense(spaceId: string | null) {
  const { space } = useCurrentSpace()
  const me = useQuery({ queryKey: ['session'], queryFn: () => getSession() })
  const members = useQuery({
    ...membersQuery(spaceId ?? ''),
    enabled: Boolean(spaceId),
  })

  const viewer = useMemo(() => {
    const userId = me.data?.user.id ?? null
    const row = (members.data ?? []).find(
      (m: MemberListItem) => m.userId === userId,
    )
    return { userId, role: row?.role ?? null }
  }, [me.data, members.data])

  const household = useMemo(
    () => ({ editableByMembers: space?.editableByMembers ?? false }),
    [space?.editableByMembers],
  )

  return (expense: Pick<ExpenseRow, 'createdByUserId'>) => {
    const reason = editBlockedReason(expense, viewer, household)
    return { canEdit: reason === null, reason }
  }
}
