/**
 * Whether the signed-in user may change a given expense.
 *
 * A mirror of `assertMayEdit` in expense.functions.ts, deliberately kept honest
 * by being wrong in a different direction: the server version is what actually
 * decides, and this only decides whether to offer the affordance. Every
 * difference between the two is a case where the UI offers an edit that then
 * fails, which is a nuisance rather than a hole.
 *
 * Two ways to pass, and only two:
 *   1. you entered it
 *   2. you entered it and did not lock it
 *
 * That is the same rule as a single sentence: *the author decides.*
 *
 * There is no household-wide override any more, and no owner override. Both were
 * tried and both are worse than the thing they replaced:
 *
 * - A household-wide switch had to be set to the most cautious value anybody in
 *   the household ever wanted, which made it useless for every expense that did
 *   not need it. "Can I correct this?" is not one question about a ledger, it is
 *   a question about a line.
 * - Letting the owner past the author's lock makes the lock a suggestion. The
 *   author set it; the person it is about does not get to walk past it.
 *
 * The cost of the second is real and worth stating plainly: an author who leaves
 * the household takes their locked entries with them, and nobody can then fix
 * them. That is a deliberate trade for a lock that means something, and the way
 * out is the author unlocking it before they go.
 *
 * `createdByUserId` is nullable because deleting an account nulls it, and that is
 * read as "not yours". A locked entry whose author has gone is therefore
 * permanently fixed — the safest reading of an unknown author, and the only one
 * that does not quietly hand authorship to whoever is left.
 */
export function mayEditExpense(
  expense: { createdByUserId: string | null; locked: boolean },
  viewer: { userId: string | null },
): boolean {
  if (!viewer.userId) return false
  if (expense.createdByUserId === viewer.userId) return true
  return !expense.locked
}

/**
 * Whether the viewer is the author, which is what makes the lock toggle theirs to
 * set and nobody else's.
 *
 * Separate from {@link mayEditExpense} because the two answer different questions
 * and the UI needs both: an author can always edit, so "can I edit" is true for
 * them whether or not they locked it, while "is this mine to lock" is a
 * different fact entirely.
 */
export function isExpenseAuthor(
  expense: { createdByUserId: string | null },
  viewer: { userId: string | null },
): boolean {
  return Boolean(viewer.userId) && expense.createdByUserId === viewer.userId
}

/**
 * Why the form is read-only, in the words to show instead.
 *
 * Null when the edit is allowed. Kept next to mayEditExpense so the two cannot
 * disagree about which case they are describing.
 *
 * `authorName` is passed in rather than looked up because the sheet already has
 * it: the row carries who typed the entry in, and "Entered by Alex" tells a
 * reader far more than "Entered by someone else" — which is the sentence this
 * returned before, and the reason a read-only expense read as a dead end
 * instead of as somebody else's entry.
 */
export function editBlockedReason(
  expense: { createdByUserId: string | null; locked: boolean },
  viewer: { userId: string | null },
  authorName?: string | null,
): string | null {
  if (mayEditExpense(expense, viewer)) return null

  // Distinguishes the two ways of being blocked, because they need different
  // words: one is somebody's deliberate instruction and the other is a gap in
  // the record, and only the first is anybody's fault.
  if (expense.createdByUserId === null) {
    return authorName
      ? `${authorName} entered this and has since deleted their account`
      : 'Entered by someone whose account has been deleted'
  }
  if (expense.locked) {
    return authorName
      ? `${authorName} locked this, so only they can change it`
      : 'The person who added this locked it'
  }
  return 'You cannot change this expense'
}
