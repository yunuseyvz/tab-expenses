/**
 * Settlement planning. Pure integer maths, no DB and no server-only imports,
 * so it is directly unit-testable and reusable from the CSV/UI layer.
 */

export interface SettlementMember {
  memberId: string
  displayName: string
  /** paid − share. Positive means the household owes them. */
  netMinor: number
}

export interface Settlement {
  fromMemberId: string
  fromName: string
  toMemberId: string
  toName: string
  amountMinor: number
}

/**
 * A recorded payment, in the form the balances need.
 *
 * Only the three fields the arithmetic touches. The name columns, the date and
 * the author are for the screen, and taking them here would mean the test for
 * "does a payment clear a debt" had to invent a whole row to answer.
 */
export interface RecordedPayment {
  fromMemberId: string
  toMemberId: string
  amountMinor: number
}

/**
 * Take recorded payments off the nets.
 *
 * A payment from A to B discharges A's debt, so A's net rises by it and B's falls.
 * Both halves matter: moving only one would change the sum of the nets and leave
 * the household's books unbalanced, which is the one thing a balance sheet must
 * never be. The sum is asserted in the tests for exactly that reason.
 *
 * Pure and exported so it is testable, and applied to the derived nets rather
 * than to `paidMinor` or `shareMinor`. Those two are the facts — what went out and
 * what was owed — and a settlement is neither: it changes what remains owed, not
 * what was spent. Writing it into either would make the column lie.
 *
 * A payment naming somebody who is not in this list is skipped rather than
 * throwing. The list is the household filtered to its active members, so an
 * archived member's payment is simply not part of the picture — and refusing to
 * render any balances at all because of a row belonging to somebody who left
 * would be a worse answer than not counting it.
 */
export function applySettlements<T extends SettlementMember>(
  balances: ReadonlyArray<T>,
  payments: ReadonlyArray<RecordedPayment>,
): Array<T> {
  const byId = new Map(balances.map((b) => [b.memberId, { ...b }]))
  for (const p of payments) {
    const from = byId.get(p.fromMemberId)
    const to = byId.get(p.toMemberId)
    if (from) from.netMinor += p.amountMinor
    if (to) to.netMinor -= p.amountMinor
  }
  return balances.map((b) => byId.get(b.memberId)!)
}

/**
 * Minimal settlement plan: repeatedly settle the largest debtor against the
 * largest creditor. Produces at most n−1 transfers for n participants, which
 * is the useful property — fewer payments, same final state.
 */
export function settle(
  balances: ReadonlyArray<SettlementMember>,
): Array<Settlement> {
  const debtors = balances
    .filter((b) => b.netMinor < 0)
    .map((b) => ({ ...b, amount: -b.netMinor }))
    .sort((a, b) => b.amount - a.amount)
  const creditors = balances
    .filter((b) => b.netMinor > 0)
    .map((b) => ({ ...b, amount: b.netMinor }))
    .sort((a, b) => b.amount - a.amount)

  const out: Array<Settlement> = []
  let di = 0
  let ci = 0

  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di]!
    const c = creditors[ci]!
    const amount = Math.min(d.amount, c.amount)
    if (amount > 0) {
      out.push({
        fromMemberId: d.memberId,
        fromName: d.displayName,
        toMemberId: c.memberId,
        toName: c.displayName,
        amountMinor: amount,
      })
    }
    d.amount -= amount
    c.amount -= amount
    if (d.amount === 0) di++
    if (c.amount === 0) ci++
  }

  return out
}
