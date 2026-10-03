/**
 * Period arithmetic, with the clock pinned.
 *
 * The interesting properties are not "this month is October" — they are the ones
 * that are easy to get subtly wrong and impossible to notice by looking:
 *
 *   · a fortnight is *aligned*, not rolling, so two adjacent ones tile exactly
 *     with no gap and no overlap, and every person in the app sees the same one
 *     on the same day;
 *   · every preset covers whole days, so no expense is dropped from one period
 *     and double-counted in another because of a DST shift;
 *   · `lastBiweek` is the fortnight immediately before `thisBiweek`, which is a
 *     stronger claim than "14 days ago" and is the one people assume.
 *
 * `new Date(y, m, d)` is local time, and the app's dates are local-calendar
 * dates with no time zone modelled (see the note at the top of period.ts). Every
 * case here is therefore stated in local time, which is the only frame in which
 * these functions are correct.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CYCLE_KEYS,
  PERIOD_PRESETS,
  asCycleKey,
  endOfWeek,
  presetToPeriod,
  startOfBiweek,
  startOfQuarter,
  startOfWeek,
  toISODate,
} from './period'

/** A `Date` at local midday, so no assertion sits on a DST boundary. */
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)

const asDate = (iso: string) =>
  at(...(iso.split('-').map(Number) as [number, number, number]))

const daysBetween = (from: string, to: string) =>
  (asDate(to).getTime() - asDate(from).getTime()) / 86_400_000

afterEach(() => {
  vi.useRealTimers()
})

describe('week boundaries', () => {
  it('starts a week on Sunday and ends it on Saturday', () => {
    // 2026-10-03 is a Saturday.
    const sat = at(2026, 10, 3)
    expect(toISODate(startOfWeek(sat))).toBe('2026-09-27')
    expect(toISODate(endOfWeek(sat))).toBe('2026-10-03')
  })

  /**
   * The off-by-one that turns a 7-day cycle into 8. `getDay()` is 0 on a Sunday,
   * so subtracting it must be a no-op rather than a day.
   */
  it('treats a Sunday as the start, not the day before', () => {
    const sun = at(2026, 10, 4)
    expect(toISODate(startOfWeek(sun))).toBe('2026-10-04')
    expect(toISODate(endOfWeek(sun))).toBe('2026-10-10')
  })
})

describe('fortnight boundaries', () => {
  it('is aligned to the calendar, not the last 14 days', () => {
    // Every day inside the same fortnight gives the same start. A rolling window
    // would give a different answer for each of these, which is what makes two
    // people looking at the app on different days see different weeks.
    const starts = [
      '2026-09-27',
      '2026-09-28',
      '2026-10-01',
      '2026-10-03',
      '2026-10-04',
      '2026-10-10',
    ].map((iso) => toISODate(startOfBiweek(asDate(iso))))
    expect(new Set(starts).size).toBe(1)
    expect(starts[0]).toBe('2026-09-27')

    // And the boundary is a real one: the next Sunday starts the next fortnight
    // rather than extending this one, which is what keeps consecutive cycles from
    // overlapping.
    expect(toISODate(startOfBiweek(asDate('2026-10-11')))).toBe('2026-10-11')
    expect(toISODate(startOfBiweek(asDate('2026-10-10')))).toBe('2026-09-27')
  })

  it('covers 14 days inclusive of both ends', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at(2026, 10, 3))
    const period = presetToPeriod('thisBiweek')
    // 13 days between the endpoints is 14 dates, which is the distinction that
    // matters: a half-open interval written as inclusive bounds would lose a day.
    expect(daysBetween(period.from!, period.to!)).toBe(13)
  })

  it('tiles: lastBiweek ends the day before thisBiweek starts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at(2026, 10, 3))
    const thisP = presetToPeriod('thisBiweek')
    const lastP = presetToPeriod('lastBiweek')
    expect(lastP.to! < thisP.from!).toBe(true)
    // The one day between them is a real day, not a gap in the arithmetic.
    expect(daysBetween(lastP.to!, thisP.from!)).toBe(1)
    expect(daysBetween(lastP.from!, lastP.to!)).toBe(13)
  })

  it('crosses a year boundary without falling apart', () => {
    // 2027-01-01 is a Friday, so it sits in the fortnight that began in
    // December. Getting this wrong is how a December cycle silently repeats in
    // January.
    expect(toISODate(startOfBiweek(at(2027, 1, 1)))).toBe('2026-12-20')
    // And the tail of one month and the head of the next line up exactly. December
    // 2026 begins mid-fortnight and ends mid-fortnight, so it sees three rather
    // than two — and the first belongs to a cycle that began in November, which is
    // the case that catches arithmetic done on month boundaries.
    expect(
      [
        ...new Set(
          Array.from({ length: 31 }, (_, i) =>
            toISODate(startOfBiweek(at(2026, 12, i + 1))),
          ),
        ),
      ].sort(),
    ).toEqual(['2026-11-22', '2026-12-06', '2026-12-20'])
  })

  it('picks the same fortnight whatever the day of the week', () => {
    vi.useFakeTimers()
    const starts = new Set<string>()
    for (let d = 1; d <= 31; d++) {
      vi.setSystemTime(at(2026, 10, d))
      starts.add(presetToPeriod('thisBiweek').from!)
    }
    // October 2026 spans three: the tail of one begun in September, two whole
    // ones, and the head of a third begun on the 25th.
    expect([...starts].sort()).toEqual([
      '2026-09-27',
      '2026-10-11',
      '2026-10-25',
    ])
  })
})

describe('quarter boundaries', () => {
  it('snaps to the containing quarter', () => {
    expect(toISODate(startOfQuarter(at(2026, 10, 3)))).toBe('2026-10-01')
    expect(toISODate(startOfQuarter(at(2026, 1, 15)))).toBe('2026-01-01')
    expect(toISODate(startOfQuarter(at(2026, 12, 31)))).toBe('2026-10-01')
  })
})

describe('presets', () => {
  it('every bounded preset produces a sane range', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at(2026, 10, 3))
    for (const { key } of PERIOD_PRESETS) {
      if (key === 'all') continue
      const period = presetToPeriod(key)
      expect(period.from, key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(period.to, key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(period.from! <= period.to!, key).toBe(true)
      expect(daysBetween(period.from!, period.to!), key).toBeGreaterThanOrEqual(
        6,
      )
    }
  })

  it('all is unbounded in both directions', () => {
    expect(presetToPeriod('all')).toEqual({ from: null, to: null })
  })

  it('has a unique label for every key', () => {
    const keys = PERIOD_PRESETS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    const labels = PERIOD_PRESETS.map((p) => p.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('narrowing an untrusted cycle', () => {
  it('accepts a known preset', () => {
    expect(asCycleKey('thisBiweek')).toBe('thisBiweek')
  })

  /**
   * The one that matters. A cycle written by a newer version of the app, or
   * corrupted, must not reach `presetToPeriod` — an unrecognised key matches no
   * case and returns no bounds, which is "all time". A household that settles
   * fortnightly would be shown its entire history with nothing indicating that
   * anything went wrong.
   */
  it('refuses anything it does not recognise', () => {
    expect(asCycleKey('fortnightly-v2')).toBeUndefined()
    expect(asCycleKey('')).toBeUndefined()
    expect(asCycleKey(null)).toBeUndefined()
    expect(asCycleKey(undefined)).toBeUndefined()
  })

  it('refuses "custom" and "all", which are not cycles', () => {
    // Both are real presets and `presetToPeriod` handles both, but neither is a
    // cadence anybody settles on, so neither is a valid value for this column.
    // This is why CYCLE_KEYS is a separate list from PERIOD_PRESETS rather than
    // that list filtered.
    expect(asCycleKey('custom')).toBeUndefined()
    expect(asCycleKey('all')).toBeUndefined()
    // "last" variants are presets but not cycles either: a household settles *on*
    // a cadence, not on the previous one.
    expect(asCycleKey('lastWeek')).toBeUndefined()
    expect(asCycleKey('lastMonth')).toBeUndefined()
  })

  it('accepts every cycle the Settings control offers', () => {
    for (const key of CYCLE_KEYS) {
      expect(asCycleKey(key), key).toBe(key)
    }
  })
})
