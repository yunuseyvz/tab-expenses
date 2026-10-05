/**
 * The recap comparison window, at the boundaries that break it.
 *
 * Every case here produces a number that looks reasonable on the screen. A
 * comparison against the wrong window is not a crash and not a blank; it is a
 * plausible percentage, which is why it has to be asserted rather than eyeballed.
 */
import { describe, expect, it } from 'vitest'

import { changePercent, isWholeMonth, previousWindow } from '#/lib/recap'

describe('isWholeMonth', () => {
  it('is true for a full calendar month', () => {
    expect(isWholeMonth('2026-09-01', '2026-09-30')).toBe(true)
    expect(isWholeMonth('2026-02-01', '2026-02-28')).toBe(true)
    expect(isWholeMonth('2028-02-01', '2028-02-29')).toBe(true)
  })

  it('is false for a part month and for a range spanning two', () => {
    expect(isWholeMonth('2026-10-01', '2026-10-04')).toBe(false)
    expect(isWholeMonth('2026-09-02', '2026-09-30')).toBe(false)
    expect(isWholeMonth('2026-09-01', '2026-10-31')).toBe(false)
    // A month that is a month long but the wrong one: 1-30 September is not all
    // of September.
    expect(isWholeMonth('2026-09-01', '2026-09-29')).toBe(false)
  })
})

describe('previousWindow', () => {
  it('maps a whole month to the whole month before', () => {
    expect(previousWindow('2026-09-01', '2026-09-30')).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    })
  })

  it('maps a part month to the same part of the month before', () => {
    // "So far in October" against "so far in September", not against all of it.
    expect(previousWindow('2026-10-01', '2026-10-04')).toEqual({
      from: '2026-09-01',
      to: '2026-09-04',
    })
  })

  it('clamps when the previous month is shorter', () => {
    // 31 March has no counterpart in February, so the window ends on the 28th
    // rather than rolling into March.
    expect(previousWindow('2026-03-01', '2026-03-31')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
    expect(previousWindow('2026-03-01', '2026-03-31')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })

  it('skips February in a leap year correctly', () => {
    expect(previousWindow('2028-03-01', '2028-03-31')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    })
  })

  it('crosses a year boundary', () => {
    expect(previousWindow('2026-01-01', '2026-01-31')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    })
    // And a leap-year December into January.
    expect(previousWindow('2026-01-01', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-15',
    })
  })

  it('never overlaps or includes the range it compares against', () => {
    const from = '2026-03-01'
    const to = '2026-03-31'
    const prev = previousWindow(from, to)
    expect(prev.to < from).toBe(true)
  })
})

describe('changePercent', () => {
  it('reports the change, rounded', () => {
    expect(changePercent(150, 100)).toBe(50)
    expect(changePercent(50, 100)).toBe(-50)
    expect(changePercent(100, 100)).toBe(0)
    expect(changePercent(133, 100)).toBe(33)
  })

  it('is null when there is nothing to compare against', () => {
    // A first month has not increased by 100%: there was no month to increase
    // from, and saying so is better than a number that means nothing.
    expect(changePercent(400, 0)).toBeNull()
    expect(changePercent(0, 0)).toBeNull()
  })

  it('reports a fall to nothing as -100', () => {
    // This one IS meaningful: last month had spending, this one has none.
    expect(changePercent(0, 250)).toBe(-100)
  })
})
