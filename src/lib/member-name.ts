/**
 * How a member's name is shown once they have left.
 *
 * `archiveMember` sets `archived_at` and leaves the row in place. That is
 * deliberate and load-bearing: `expense_split.member_id` restricts on it, so
 * deleting the row would either fail or take the splits with it, and either way
 * last quarter's balances would stop adding up. The name has to survive the
 * person.
 *
 * What was missing is a way to *say* that. The name rendered exactly as it did
 * when they were an active member, so a ledger read in March 2027 showed a
 * household with four people on the roster at some point in its history and
 * three people who can be assigned a new expense — with nothing on screen to
 * distinguish the two.
 *
 * So a removed member renders as `Name (removed)`. Their name is kept, because
 * the ledger records what happened; the suffix is the only new fact, and it is
 * the one a reader cannot infer. Plain ASCII in parentheses rather than an
 * em-dash construction, because it has to sit inline in a list row and in a
 * balance table without wrapping awkwardly.
 *
 * Takes the whole `archivedAt` rather than a boolean so call sites cannot get
 * the two confused, which is the one mistake that would put "(removed)" on
 * somebody who is still on the roster.
 */
export function displayMemberName(
  displayName: string,
  archivedAt?: Date | string | null,
): string {
  if (!archivedAt) return displayName
  return `${displayName} (removed)`
}
