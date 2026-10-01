/**
 * Calendar grid arithmetic.
 *
 * Every case here is a bug that would be invisible in a screenshot and obvious
 * to whoever clicked near the edge of the month.
 */
import { describe, expect, it } from 'vitest'

import {
  addMonths,
  fromISODate,
  isSameDay,
  monthGrid,
  startOfMonth,
  toISODate,
} from './calendar'

const grid = (y: number, m: number, today = new Date(2026, 8, 30)) =>
  monthGrid(new Date(y, m, 1), today)

describe('toISODate / fromISODate', () => {
  it('round-trips a date without drifting', () => {
    for (const iso of [
      '2026-01-01',
      '2026-02-28',
      '2026-03-31',
      '2026-12-31',
      '2024-02-29',
    ]) {
      expect(toISODate(fromISODate(iso))).toBe(iso)
    }
  })

  it('zero-pads single-digit months and days', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('builds local midnight, not UTC', () => {
    // new Date('2026-03-01') is UTC midnight, which is the previous day for
    // anyone west of Greenwich — the classic off-by-one that moves an expense
    // to the wrong date.
    const d = fromISODate('2026-03-01')
    expect(d.getDate()).toBe(1)
    expect(d.getHours()).toBe(0)
  })
})

describe('startOfMonth', () => {
  it('clamps to the first of the month', () => {
    const d = startOfMonth(new Date(2026, 8, 30))
    expect(d.getDate()).toBe(1)
    expect(d.getMonth()).toBe(8)
  })
})

describe('addMonths', () => {
  it('moves forwards and backwards', () => {
    expect(addMonths(new Date(2026, 0, 1), 1).getMonth()).toBe(1)
    expect(addMonths(new Date(2026, 0, 1), -1).getMonth()).toBe(11)
  })

  it('rolls the year over in both directions', () => {
    expect(addMonths(new Date(2026, 11, 1), 1).getFullYear()).toBe(2027)
    expect(addMonths(new Date(2026, 0, 1), -1).getFullYear()).toBe(2025)
  })

  it('does not skip a month when the day-of-month does not exist', () => {
    // Date normalisation is the trap: new Date(2026, 0, 31) - 1 month is the
    // 3rd of March, not the 31st of December. addMonths always works from the
    // 1st, so it steps through months reliably.
    expect(addMonths(new Date(2026, 0, 31), 1).getMonth()).toBe(1)
  })
})

describe('isSameDay', () => {
  it('is true for the same calendar day', () => {
    expect(
      isSameDay(new Date(2026, 8, 30), new Date(2026, 8, 30, 23, 59)),
    ).toBe(true)
  })

  it('is false across a month or year boundary', () => {
    expect(isSameDay(new Date(2026, 8, 30), new Date(2026, 9, 30))).toBe(false)
    expect(isSameDay(new Date(2026, 0, 1), new Date(2025, 0, 1))).toBe(false)
  })
})

describe('monthGrid', () => {
  it('is always 42 cells, so the popover does not change height', () => {
    // February 2026 starts on a Sunday and has 28 days: the shortest month and
    // the one that would otherwise fit in five rows.
    for (const [y, m] of [
      [2026, 1],
      [2026, 8],
      [2024, 1],
      [2026, 0],
    ] as Array<[number, number]>) {
      expect(grid(y, m)).toHaveLength(42)
    }
  })

  it('starts on a Monday', () => {
    for (const [y, m] of [
      [2026, 1],
      [2026, 8],
      [2024, 1],
    ] as Array<[number, number]>) {
      expect(grid(y, m)[0]!.date.getDay()).toBe(1)
    }
  })

  it('contains every day of the target month exactly once', () => {
    const cells = grid(2026, 8)
    const inMonth = cells.filter((c) => c.inMonth)
    expect(inMonth).toHaveLength(30)
    expect(new Set(inMonth.map((c) => c.iso)).size).toBe(30)
    expect(inMonth[0]!.iso).toBe('2026-09-01')
    expect(inMonth.at(-1)!.iso).toBe('2026-09-30')
  })

  it('handles a leap February', () => {
    const inMonth = grid(2024, 1).filter((c) => c.inMonth)
    expect(inMonth).toHaveLength(29)
    expect(inMonth.at(-1)!.iso).toBe('2024-02-29')
  })

  it('pads the leading days with the previous month', () => {
    // September 2026 starts on a Tuesday, so one borrowed day precedes it.
    const cells = grid(2026, 8)
    expect(cells[0]!.inMonth).toBe(false)
    expect(cells[0]!.iso).toBe('2026-08-31')
    expect(cells[1]!.inMonth).toBe(true)
  })

  it('emits consecutive dates with no gap or repeat', () => {
    const cells = grid(2026, 8)
    for (let i = 1; i < cells.length; i++) {
      const prev = fromISODate(cells[i - 1]!.iso)
      const cur = fromISODate(cells[i]!.iso)
      const diff = (cur.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
      expect(diff).toBe(1)
    }
  })

  it('marks today only on the matching cell', () => {
    const today = new Date(2026, 8, 30)
    const cells = grid(2026, 8, today)
    const marked = cells.filter((c) => c.isToday)
    expect(marked).toHaveLength(1)
    expect(marked[0]!.iso).toBe('2026-09-30')
  })
})
