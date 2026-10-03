import { describe, expect, it } from 'vitest'

import {
  amountStringSchema,
  categoryInputSchema,
  expenseInputSchema,
  isoDateSchema,
} from './guards'
import {
  PERIOD_PRESETS,
  groupByDay,
  periodControlLabel,
  periodLabel,
  presetToPeriod,
  resolvePeriod,
  toISODate,
} from './period'
import { settle } from './settle'
import type { PeriodPreset } from './period'

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

describe('periodControlLabel', () => {
  it('names the preset when there is one', () => {
    // `all` is excluded on purpose and has its own test below: "All" names the
    // choice, so the control says what it shows instead.
    for (const { key, label } of PERIOD_PRESETS.filter(
      (p) => p.key !== 'all',
    )) {
      expect(periodControlLabel(key)).toBe(label)
    }
  })

  /**
   * The case that produced a button with an icon, a chevron and nothing between
   * them. The routes cast `?period=` without checking it, so a value this build
   * does not know reaches the control; `presetToPeriod` matches no case for it
   * and yields no bounds, so the loader showed all time and the label has to say
   * so too. Anything else here is a control that disagrees with the list under it.
   */
  it('describes the window when the preset is not one it knows', () => {
    const bogus = 'lastQuarter' as PeriodPreset
    expect(PERIOD_PRESETS.some((p) => p.key === bogus)).toBe(false)
    // No bounds, which is the whole claim: the label and the query agree.
    expect(presetToPeriod(bogus)).toEqual({ from: null, to: null })
    expect(resolvePeriod(bogus)).toEqual({ from: null, to: null })
    // And the label function survives being handed it, which it did not: it used
    // to throw inside periodLabel on the undefined this produced.
    expect(() => periodLabel(resolvePeriod(bogus))).not.toThrow()
    expect(periodControlLabel(bogus)).toBe('All time')
    expect(periodControlLabel(bogus)).not.toBe('')
  })

  it('describes a custom range as dates, since it has no name to show', () => {
    expect(periodControlLabel('custom', '2026-09-28', '2026-10-11')).toBe(
      'Sep 28, 2026 – Oct 11, 2026',
    )
    expect(periodControlLabel('custom', '2026-09-28')).toBe('from Sep 28, 2026')
    expect(periodControlLabel('custom', undefined, '2026-10-11')).toBe(
      'until Oct 11, 2026',
    )
    // Neither bound set is not an error, it is all time, and it says so rather
    // than showing the word "Custom".
    expect(periodControlLabel('custom')).toBe('All time')
  })

  it('calls the unbounded preset the window rather than the mechanism', () => {
    // "All" names the choice, not the answer.
    expect(periodControlLabel('all')).toBe('All time')
  })

  it('never returns an empty string, whatever it is handed', () => {
    // The empty-button bug, pinned at the level it can be pinned without a
    // browser: a value with no preset name behind it still gets the window.
    for (const key of [
      'all',
      'custom',
      'unknown',
      '',
      'week',
      'lastQuarter',
      'THISMONTH',
    ] as Array<PeriodPreset>) {
      expect(
        periodControlLabel(key).length,
        JSON.stringify(key),
      ).toBeGreaterThan(0)
    }
  })

  it('never contradicts the bounds the loader used', () => {
    // The invariant that matters: whatever the button says, the list underneath is
    // showing those dates. A bounded preset deliberately reads as its name rather
    // than as its dates, so the test is that the two are *distinguishable* — if
    // they ever came out identical the control would be describing the wrong
    // thing without looking wrong.
    for (const key of [
      'thisWeek',
      'lastBiweek',
      'thisMonth',
      'thisQuarter',
    ] as Array<PeriodPreset>) {
      const resolved = resolvePeriod(key)
      expect(resolved.from, key).not.toBeNull()
      expect(periodControlLabel(key)).not.toBe(periodLabel(resolved))
    }
  })
})

describe('the amount ceiling', () => {
  /**
   * The cap has three enforcement points and this asserts the outermost one
   * returns a validation error rather than throwing. That last part is the one
   * worth having: the check is `isAmountTooLarge` rather than
   * `parseAmountToMinor` precisely because zod runs every refinement even after an
   * earlier one has failed, so a malformed amount reached the throwing parser and
   * escaped as a RangeError.
   */
  it('accepts the ceiling and refuses one cent over', () => {
    expect(amountStringSchema.safeParse('9999999.99').success).toBe(true)
    expect(amountStringSchema.safeParse('10000000').success).toBe(false)
  })

  it('names the limit in the message, so it can be acted on', () => {
    const result = amountStringSchema.safeParse('10000000')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('9999999.99')
  })

  it('returns a failure for junk rather than throwing', () => {
    for (const bad of ['-5', 'abc', '', '1.234', '1.2.3', '  ']) {
      const result = amountStringSchema.safeParse(bad)
      expect(result.success, bad).toBe(false)
    }
  })

  it('catches a units slip that is still well-formed', () => {
    // The realistic failure: a total pasted in cents. Perfectly valid input, and
    // only the ceiling stops it.
    expect(amountStringSchema.safeParse('123456.78').success).toBe(true)
    expect(amountStringSchema.safeParse('12345678').success).toBe(false)
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
