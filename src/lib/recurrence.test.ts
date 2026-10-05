/**
 * Recurrence maths: the schedule a repeating expense keeps.
 *
 * The drift test is the one that matters. "Next month" written naively turns a
 * series anchored on the 31st into one anchored on the 28th the first time it
 * passes February, and nothing about that failure is visible until March — by
 * which point rent has been due on the wrong day for a month. So the anchor is
 * asserted separately from the cursor everywhere it can be.
 *
 * The week-number tests walk the two boundaries that break home-grown ISO weeks:
 * late December, which belongs to the next year's week 1, and a leap year, which
 * is where an off-by-one in the day arithmetic shows up.
 */
import { describe, expect, it } from 'vitest'

import {
  anchorDayOf,
  dueOccurrences,
  nextOccurrence,
  periodKey,
} from '#/lib/recurrence'

describe('nextOccurrence', () => {
  it('keeps the anchor day across a short month', () => {
    // The drift bug, walked through its whole cycle. Rent on the 31st is due on
    // the 31st in March even though February had to use the 28th.
    expect(nextOccurrence('2026-01-31', 'monthly', 31)).toBe('2026-02-28')
    expect(nextOccurrence('2026-02-28', 'monthly', 31)).toBe('2026-03-31')
    expect(nextOccurrence('2026-03-31', 'monthly', 31)).toBe('2026-04-30')
    expect(nextOccurrence('2026-04-30', 'monthly', 31)).toBe('2026-05-31')
  })

  it('handles February in a leap year', () => {
    expect(nextOccurrence('2028-01-31', 'monthly', 31)).toBe('2028-02-29')
    expect(nextOccurrence('2028-02-29', 'monthly', 31)).toBe('2028-03-31')
  })

  it('rolls the year over', () => {
    expect(nextOccurrence('2026-12-15', 'monthly', 15)).toBe('2027-01-15')
  })

  it('adds seven days for weekly', () => {
    expect(nextOccurrence('2026-10-04', 'weekly', 4)).toBe('2026-10-11')
    // Across a month boundary and a 31-day month.
    expect(nextOccurrence('2026-10-29', 'weekly', 4)).toBe('2026-11-05')
  })

  it('never returns the date it was given', () => {
    // A cursor that did not move would make the catch-up loop spin.
    for (const d of ['2026-01-01', '2026-02-28', '2026-12-31']) {
      for (const f of ['monthly', 'weekly'] as const) {
        expect(nextOccurrence(d, f, anchorDayOf(d)) > d).toBe(true)
      }
    }
  })
})

describe('periodKey', () => {
  it('is the month for a monthly series', () => {
    expect(periodKey('monthly', '2026-10-01')).toBe('2026-10')
    expect(periodKey('monthly', '2026-10-31')).toBe('2026-10')
    // Same month, same key — which is what the unique index relies on.
    expect(periodKey('monthly', '2026-10-01')).toBe(
      periodKey('monthly', '2026-10-31'),
    )
  })

  it('is the ISO week for a weekly series', () => {
    // 2026-01-01 is a Thursday, so week 1 contains it.
    expect(periodKey('weekly', '2026-01-01')).toBe('2026-W01')
    expect(periodKey('weekly', '2026-01-05')).toBe('2026-W02')
  })

  it('puts late December in the following year, week 1', () => {
    // 2025-12-29 is a Monday and the Thursday of its week is 2026-01-01, so the
    // whole week — including the December days — is 2026's week 1. Getting this
    // wrong would give a December occurrence a different key from the January one
    // in the same week, and the unique index would then create a duplicate rather
    // than refusing one.
    expect(periodKey('weekly', '2025-12-29')).toBe('2026-W01')
    expect(periodKey('weekly', '2026-01-01')).toBe('2026-W01')
    expect(periodKey('weekly', '2026-01-05')).toBe('2026-W02')
  })

  it('knows which years have 53 weeks', () => {
    // 2026 starts on a Thursday, which is the rule that gives a year 53 ISO
    // weeks. A home-grown week counter that assumed 52 would wrap this to week 1
    // and collide it with January.
    expect(periodKey('weekly', '2026-12-31')).toBe('2026-W53')
    expect(periodKey('weekly', '2026-12-28')).toBe('2026-W53')
  })

  it('gives every day of a month a unique key, for both frequencies', () => {
    // The collision test: two occurrences sharing a key is the failure that the
    // unique index turns from "duplicate rent" into "a month with no rent".
    const monthly = new Set<string>()
    const weekly = new Set<string>()
    for (let d = 1; d <= 28; d++) {
      const iso = `2026-02-${String(d).padStart(2, '0')}`
      monthly.add(periodKey('monthly', iso))
      weekly.add(periodKey('weekly', iso))
    }
    expect(monthly.size).toBe(1)
    // Four whole weeks in four weeks of February, minus the ones that overlap.
    expect(weekly.size).toBeGreaterThanOrEqual(4)
  })
})

describe('dueOccurrences', () => {
  it('creates every missed month after a long outage', () => {
    // The container was down from January to April. The next read catches up
    // rather than skipping to the current month, because the rent was still due.
    const { due, cursor } = dueOccurrences(
      '2026-01-15',
      'monthly',
      15,
      '2026-04-20',
    )
    expect(due.map((o) => o.date)).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ])
    expect(due.map((o) => o.key)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ])
    // The cursor is the next one that is NOT due, and is stored with them.
    expect(cursor).toBe('2026-05-15')
  })

  it('does nothing when nothing is due', () => {
    const { due, cursor } = dueOccurrences(
      '2026-11-01',
      'monthly',
      1,
      '2026-10-20',
    )
    expect(due).toEqual([])
    expect(cursor).toBe('2026-11-01')
  })

  it('includes an occurrence falling exactly today', () => {
    const { due } = dueOccurrences('2026-10-04', 'weekly', 4, '2026-10-04')
    expect(due.map((o) => o.date)).toEqual(['2026-10-04'])
  })

  it('is idempotent: running again from the returned cursor yields nothing', () => {
    // This is what makes materialising on every read safe.
    const first = dueOccurrences('2026-01-15', 'monthly', 15, '2026-03-20')
    const second = dueOccurrences(first.cursor, 'monthly', 15, '2026-03-20')
    expect(second.due).toEqual([])
    expect(second.cursor).toBe(first.cursor)
  })

  it('stops at the guard rather than looping forever on a bad cursor', () => {
    // A cursor decades in the past must not spawn an unbounded insert loop in a
    // request. Capped, and the next read picks up where this one stopped.
    const { due, cursor } = dueOccurrences(
      '2000-01-01',
      'weekly',
      1,
      '2026-10-04',
    )
    expect(due.length).toBe(120)
    expect(cursor > '2000-01-01').toBe(true)
  })
})
