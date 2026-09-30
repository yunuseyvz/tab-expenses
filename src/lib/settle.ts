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
