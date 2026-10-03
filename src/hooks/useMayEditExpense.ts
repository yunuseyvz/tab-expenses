/**
 * Whether the signed-in user may change an expense, and why not if they may not.
 *
 * Every screen with a tap-to-open expense row needs the same answer. The server
 * already decides — see `assertMayEdit` in expense.functions — and this hook is
 * only the UI half: it decides whether to offer the affordance or to say why
 * there isn't one, so a member does not fill in a form and then get refused.
 *
 * It used to also need the household's permission setting and the viewer's role,
 * which made it three queries deep to answer a question about one row. The
 * per-expense lock removed both, and with them the members query: all that is
 * left is who you are, and the row already says who wrote it.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { ExpenseRow } from '#/lib/expense.functions'
import { getSession } from '#/lib/auth.functions'
import {
  editBlockedReason,
  isExpenseAuthor,
  mayEditExpense,
} from '#/lib/may-edit'

/** What a row needs to answer for one viewer. */
export type ExpenseEditability = {
  canEdit: boolean
  /** Why not, in words. Null exactly when `canEdit`. */
  reason: string | null
  /** Whether the lock toggle in the sheet is yours to press. */
  isAuthor: boolean
}

export function useMayEditExpense() {
  const me = useQuery({ queryKey: ['session'], queryFn: () => getSession() })

  const viewer = useMemo(
    () => ({ userId: me.data?.user.id ?? null }),
    [me.data],
  )

  return (
    expense: Pick<ExpenseRow, 'createdByUserId' | 'locked' | 'createdByName'>,
  ): ExpenseEditability => {
    const canEdit = mayEditExpense(expense, viewer)
    return {
      canEdit,
      reason: canEdit
        ? null
        : editBlockedReason(expense, viewer, expense.createdByName),
      isAuthor: isExpenseAuthor(expense, viewer),
    }
  }
}
