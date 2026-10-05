/**
 * Settlements, as arithmetic.
 *
 * The invariant that matters is the same one the balance sheet has: the nets sum
 * to zero. A settlement moves value from one member to another and must leave
 * that sum alone. Getting one half of the pair without the other is a two-line
 * mistake that makes the household's books permanently unbalanced, and it looks
 * completely fine on the screen where the payer's own balance is the only one you
 * check.
 */
import { describe, expect, it } from 'vitest'

import type { SettlementMember } from '#/lib/settle'
import { applySettlements, settle } from '#/lib/settle'

const sum = (xs: ReadonlyArray<SettlementMember>) =>
  xs.reduce((s, x) => s + x.netMinor, 0)

/** Alex paid for everything: the household owes Alex, Sam and Robin owe. */
const three: Array<SettlementMember> = [
  { memberId: 'sam', displayName: 'Sam', netMinor: -1200 },
  { memberId: 'alex', displayName: 'Alex', netMinor: 2000 },
  { memberId: 'robin', displayName: 'Robin', netMinor: -800 },
]

describe('applySettlements', () => {
  it('clears a debt exactly', () => {
    const after = applySettlements(three, [
      { fromMemberId: 'sam', toMemberId: 'alex', amountMinor: 1200 },
    ])
    expect(after.find((b) => b.memberId === 'sam')!.netMinor).toBe(0)
    expect(after.find((b) => b.memberId === 'alex')!.netMinor).toBe(800)
    expect(after.find((b) => b.memberId === 'robin')!.netMinor).toBe(-800)
  })

  it('leaves the nets summing to zero, for every partial payment', () => {
    // Swept rather than sampled: the failure mode is a specific amount, not a
    // general tendency, and every amount is reachable by typing it.
    for (let amount = 0; amount <= 1200; amount += 50) {
      const after = applySettlements(three, [
        { fromMemberId: 'sam', toMemberId: 'alex', amountMinor: amount },
      ])
      expect(sum(after)).toBe(0)
    }
  })

  it('makes the plan empty once everybody has paid', () => {
    // What the feature is for: the "Settle up" card empties itself instead of
    // listing the same two rows every month forever.
    const after = applySettlements(three, [
      { fromMemberId: 'sam', toMemberId: 'alex', amountMinor: 1200 },
      { fromMemberId: 'robin', toMemberId: 'alex', amountMinor: 800 },
    ])
    expect(after.every((b) => b.netMinor === 0)).toBe(true)
    expect(settle(after)).toEqual([])
  })

  it('overpaying flips the side, rather than clamping', () => {
    // Sam owed 1200 and hands over 1500: Alex now owes Sam 300. That is the
    // truthful reading and it is what makes an advance payment work, rather than
    // a payment that vanishes because it was too big.
    const after = applySettlements(three, [
      { fromMemberId: 'sam', toMemberId: 'alex', amountMinor: 1500 },
    ])
    expect(after.find((b) => b.memberId === 'sam')!.netMinor).toBe(300)
    expect(after.find((b) => b.memberId === 'alex')!.netMinor).toBe(500)
    expect(sum(after)).toBe(0)
  })

  it('ignores a payment naming somebody who is not in the household', () => {
    // A member archived after the payment was recorded. Skipping it is the only
    // answer that still renders the rest of the balances.
    const after = applySettlements(three, [
      { fromMemberId: 'ghost', toMemberId: 'alex', amountMinor: 500 },
    ])
    expect(after.find((b) => b.memberId === 'alex')!.netMinor).toBe(1500)
  })

  it('does not mutate what it was given', () => {
    const before = JSON.stringify(three)
    applySettlements(three, [
      { fromMemberId: 'sam', toMemberId: 'alex', amountMinor: 1200 },
    ])
    expect(JSON.stringify(three)).toBe(before)
  })

  it('handles no payments at all', () => {
    expect(applySettlements(three, [])).toEqual(three)
  })
})
