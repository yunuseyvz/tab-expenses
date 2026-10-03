/**
 * Whether the signed-in user may change a given expense.
 *
 * A mirror of `assertMayEdit` in expense.functions.ts, deliberately kept honest
 * by being wrong in a different direction: the server version is what actually
 * decides, and this only decides whether to offer the affordance. Every
 * difference between the two is a case where the UI offers an edit that then
 * fails, which is a nuisance rather than a hole.
 *
 * The same three ways to pass, and the same order:
 *   1. you entered it
 *   2. you own the household
 *   3. the household has opened its ledger to each other
 *
 * `createdByUserId` is nullable because deleting an account nulls it. That is
 * treated as "not yours": an expense entered by somebody who has since deleted
 * their account cannot be edited by anybody but an owner, which is the safe
 * reading of an unknown author.
 */
export function mayEditExpense(
  expense: { createdByUserId: string | null },
  viewer: { userId: string | null; role: string | null },
  household: { editableByMembers: boolean },
): boolean {
  if (!viewer.userId) return false
  if (expense.createdByUserId === viewer.userId) return true
  if (viewer.role === 'owner') return true
  return household.editableByMembers
}

/**
 * Why the edit button is not offered, in the words to show instead.
 *
 * Null when the edit is allowed. Kept next to mayEditExpense so the two cannot
 * disagree about which case they are describing.
 */
export function editBlockedReason(
  expense: { createdByUserId: string | null },
  viewer: { userId: string | null; role: string | null },
  household: { editableByMembers: boolean },
): string | null {
  if (mayEditExpense(expense, viewer, household)) return null
  if (expense.createdByUserId === null) {
    return 'Entered by someone who has since deleted their account'
  }
  return 'Entered by someone else'
}
