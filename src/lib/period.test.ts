import { describe, expect, it } from 'vitest'

import {
  amountStringSchema,
  categoryInputSchema,
  expenseInputSchema,
  isoDateSchema,
} from './guards'
import { groupByDay, presetToPeriod, toISODate } from './period'
import { settle } from './settle'

describe('settle', () => {
  it('balances the plan’s 60/40 shared-flat scenario to zero', () => {
    // You paid €100 and 60% is yours, 40% is Kai's.
    // paid: you 100, Kai 0. shares: you 60, Kai 40.
    // nets: you +40, Kai −40.
    const settlements = settle([
      { memberId: 'me', displayName: 'Me', netMinor: 4000 },
      { memberId: 'kai', displayName: 'Kai', netMinor: -4000 },
    ])

    expect(settlements).toEqual([
      {
        fromMemberId: 'kai',
        fromName: 'Kai',
        toMemberId: 'me',
        toName: 'Me',
        amountMinor: 4000,
      },
    ])
  })

  it('produces no transfers when everyone is square', () => {
    expect(
      settle([
        { memberId: 'a', displayName: 'A', netMinor: 0 },
        { memberId: 'b', displayName: 'B', netMinor: 0 },
      ]),
    ).toEqual([])
  })

  it('emits at most n−1 transfers', () => {
    const nets = [5000, 3000, -2000, -4000, -2000]
    const balances = nets.map((netMinor, i) => ({
      memberId: `m${i}`,
      displayName: `M${i}`,
      netMinor,
    }))

    const out = settle(balances)
    expect(out.length).toBeLessThanOrEqual(balances.length - 1)
  })

  it('nets out to zero — no money created or destroyed', () => {
    const nets = [1234, -400, -834, 7000, -7000]
    const balances = nets.map((netMinor, i) => ({
      memberId: `m${i}`,
      displayName: `M${i}`,
      netMinor,
    }))

    const out = settle(balances)
    const delta = new Map<string, number>()
    for (const b of balances) delta.set(b.memberId, b.netMinor)
    for (const s of out) {
      delta.set(s.fromMemberId, delta.get(s.fromMemberId)! + s.amountMinor)
      delta.set(s.toMemberId, delta.get(s.toMemberId)! - s.amountMinor)
    }
    for (const v of delta.values()) expect(v).toBe(0)
  })

  it('handles a single member who is owed money', () => {
    expect(
      settle([{ memberId: 'a', displayName: 'A', netMinor: 5000 }]),
    ).toEqual([])
  })

  it('a 1¢ 60/40 split owes nobody anything', () => {
    // shares 1/0 → nets +1 and 0, so there is no transfer at all.
    const out = settle([
      { memberId: 'me', displayName: 'Me', netMinor: 1 },
      { memberId: 'you', displayName: 'You', netMinor: 0 },
    ])
    expect(out).toEqual([])
  })
})

describe('period', () => {
  it('formats dates as local YYYY-MM-DD, not UTC', () => {
    // A UTC-based toISOString would roll this back a day in CET.
    expect(toISODate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
    expect(toISODate(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31')
  })

  it('resolves presets to whole calendar months', () => {
    const now = new Date()
    const thisMonth = presetToPeriod('thisMonth')
    expect(thisMonth.from).toBe(
      toISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
    )
    expect(thisMonth.to).toBe(
      toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    )

    const lastMonth = presetToPeriod('lastMonth')
    const expectedPrefix = toISODate(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
    ).slice(0, 7)
    expect(lastMonth.from!.startsWith(expectedPrefix)).toBe(true)
  })

  it('treats "all" as unbounded', () => {
    expect(presetToPeriod('all')).toEqual({ from: null, to: null })
  })
})

describe('groupByDay', () => {
  it('buckets by day, newest first, and totals each day', () => {
    const expenses = [
      { spentOn: '2026-03-01', amountMinor: 1000 },
      { spentOn: '2026-03-03', amountMinor: 2500 },
      { spentOn: '2026-03-01', amountMinor: 500 },
    ]

    const groups = groupByDay(expenses)
    expect(groups.map((g) => g.date)).toEqual(['2026-03-03', '2026-03-01'])
    expect(groups[1]!.totalMinor).toBe(1500)
    expect(groups[1]!.items).toHaveLength(2)
  })

  it('handles an empty list', () => {
    expect(groupByDay([])).toEqual([])
  })
})

// ── input validation ──────────────────────────────────────────────────────

describe('isoDateSchema', () => {
  it('accepts real calendar dates', () => {
    expect(isoDateSchema.safeParse('2026-03-01').success).toBe(true)
    expect(isoDateSchema.safeParse('2024-02-29').success).toBe(true) // leap year
  })

  it('rejects impossible dates that would silently shift', () => {
    // Postgres would reject these, but failing at validation gives a field
    // error rather than a 500.
    expect(isoDateSchema.safeParse('2026-02-31').success).toBe(false)
    expect(isoDateSchema.safeParse('2026-13-01').success).toBe(false)
    expect(isoDateSchema.safeParse('2026-00-10').success).toBe(false)
    expect(isoDateSchema.safeParse('2023-02-29').success).toBe(false) // not a leap year
  })

  it('rejects malformed input', () => {
    expect(isoDateSchema.safeParse('01/03/2026').success).toBe(false)
    expect(isoDateSchema.safeParse('2026-3-1').success).toBe(false)
    expect(isoDateSchema.safeParse('').success).toBe(false)
  })
})

describe('amountStringSchema', () => {
  it('accepts 1–2 decimals and a comma separator', () => {
    expect(amountStringSchema.safeParse('12').success).toBe(true)
    expect(amountStringSchema.safeParse('12.3').success).toBe(true)
    expect(amountStringSchema.safeParse('12.34').success).toBe(true)
    expect(amountStringSchema.safeParse('12,34').success).toBe(true)
  })

  it('rejects zero, negatives, and excess precision', () => {
    expect(amountStringSchema.safeParse('0').success).toBe(false)
    expect(amountStringSchema.safeParse('0.00').success).toBe(false)
    expect(amountStringSchema.safeParse('-5').success).toBe(false)
    expect(amountStringSchema.safeParse('1.234').success).toBe(false)
    expect(amountStringSchema.safeParse('abc').success).toBe(false)
  })
})

describe('categoryInputSchema', () => {
  const base = {
    spaceId: 'a'.repeat(0) + '018f0000-0000-7000-8000-000000000001',
    name: 'Home',
  }

  it('requires an owner for a personal category', () => {
    // Mirrors the category_scope_owner_ck check constraint, but at validation
    // time so the user gets a field error instead of a constraint violation.
    const r = categoryInputSchema.safeParse({
      ...base,
      color: 'terracotta',
      icon: 'home',
      scope: 'personal',
      ownerMemberId: null,
    })
    expect(r.success).toBe(false)
  })

  it('rejects a shared category that names an owner', () => {
    const r = categoryInputSchema.safeParse({
      ...base,
      color: 'terracotta',
      icon: 'home',
      scope: 'shared',
      ownerMemberId: '018f0000-0000-7000-8000-000000000002',
    })
    expect(r.success).toBe(false)
  })

  it('accepts a well-formed pair', () => {
    expect(
      categoryInputSchema.safeParse({
        ...base,
        color: 'terracotta',
        icon: 'home',
        scope: 'personal',
        ownerMemberId: '018f0000-0000-7000-8000-000000000002',
      }).success,
    ).toBe(true)
    expect(
      categoryInputSchema.safeParse({
        ...base,
        color: 'sage',
        icon: 'sprout',
        scope: 'shared',
        ownerMemberId: null,
      }).success,
    ).toBe(true)
  })

  it('rejects an icon outside the curated set', () => {
    // The set is closed on purpose. The name is stored in the database and
    // rendered as a component, so an unrecognised value would be a blank box in
    // the category list — and an arbitrary string from the client is not
    // something to persist. This used to be free text and accepted anything.
    expect(
      categoryInputSchema.safeParse({
        ...base,
        color: 'sage',
        icon: 'leaf',
        scope: 'shared',
        ownerMemberId: null,
      }).success,
    ).toBe(false)
  })
})

describe('expenseInputSchema', () => {
  const base = {
    spaceId: '018f0000-0000-7000-8000-000000000001',
    amount: '100.00',
    paidByMemberId: '018f0000-0000-7000-8000-000000000002',
    spentOn: '2026-03-01',
    purpose: 'Weekly shop',
  }

  it('accepts a simple expense with no splits', () => {
    expect(expenseInputSchema.safeParse(base).success).toBe(true)
  })

  it('accepts an explicit split list', () => {
    const r = expenseInputSchema.safeParse({
      ...base,
      splits: [
        { memberId: '018f0000-0000-7000-8000-000000000002', weightBp: 6000 },
        { memberId: '018f0000-0000-7000-8000-000000000003', weightBp: 4000 },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('rejects a bad amount, date, or empty purpose', () => {
    expect(
      expenseInputSchema.safeParse({ ...base, amount: 'abc' }).success,
    ).toBe(false)
    expect(expenseInputSchema.safeParse({ ...base, amount: '0' }).success).toBe(
      false,
    )
    expect(
      expenseInputSchema.safeParse({ ...base, spentOn: '2026-02-31' }).success,
    ).toBe(false)
    expect(
      expenseInputSchema.safeParse({ ...base, purpose: '   ' }).success,
    ).toBe(false)
  })

  it('rejects a split weight outside 0..10000', () => {
    const r = expenseInputSchema.safeParse({
      ...base,
      splits: [
        { memberId: '018f0000-0000-7000-8000-000000000002', weightBp: 10_001 },
      ],
    })
    expect(r.success).toBe(false)
  })
})
