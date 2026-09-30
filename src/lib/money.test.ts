import { describe, expect, it } from 'vitest'
import {
  BP_TOTAL,
  allocate,
  formatMinor,
  formatMoney,
  parseAmountToMinor,
} from './money'

describe('allocate', () => {
  it('matches the plan’s worked examples', () => {
    expect(allocate(1000, [6000, 4000])).toEqual([600, 400])
    expect(allocate(1, [6000, 4000])).toEqual([1, 0])
    expect(allocate(12345, [6000, 4000])).toEqual([7407, 4938])
  })

  it('5¢ at 50/30/20 is 3/1/1, not the 3/2/0 printed in the plan', () => {
    // Exact shares are 2.5 / 1.5 / 1.0. Floors give 2/1/1 = 4, leaving one
    // cent, which goes to the largest remainder (index 0). Result sums to 5.
    // The plan's table says "3 / 2 / 0": it sums to 5 but is not a valid
    // 50/30/20 allocation — the 20% share would be 1 cent, not 0.
    const shares = allocate(5, [5000, 3000, 2000])
    expect(shares).toEqual([3, 1, 1])
    expect(shares.reduce((s, x) => s + x, 0)).toBe(5)
  })

  it('always sums to the exact amount, with no phantom cents', () => {
    const cases: Array<[number, Array<number>]> = [
      [0, [5000, 5000]],
      [1, [5000, 5000]],
      [2, [5000, 5000]],
      [3, [6000, 4000]],
      [7, [3333, 3333, 3334]],
      [99, [1234, 5678, 3088]],
      [100_000, [1, 9999]],
      [12_345, [1, 1, 9998]],
      [7, [5000, 2500, 2500]],
      [1, [1, 9999]],
    ]

    for (const [amount, weights] of cases) {
      const shares = allocate(amount, weights)
      expect(shares.reduce((s, x) => s + x, 0)).toBe(amount)
      // every share is a whole cent, never negative
      expect(shares.every((s) => Number.isInteger(s) && s >= 0)).toBe(true)
    }
  })

  it('is deterministic — equal remainders break by index', () => {
    // 2 cents over three near-equal weights: 0.666, 0.666, 0.666 -> floors all
    // zero, both leftover cents go to the two largest remainders (indexes 0,1).
    expect(allocate(2, [3334, 3333, 3333])).toEqual([1, 1, 0])
    // repeated calls give identical output
    const w = [4001, 3000, 2999]
    expect(allocate(1001, w)).toEqual(allocate(1001, w))
  })

  it('gives a single member the whole amount', () => {
    expect(allocate(9999, [BP_TOTAL])).toEqual([9999])
    expect(allocate(9999, [0, BP_TOTAL])).toEqual([0, 9999])
  })

  it('rejects weights that do not sum to 10000', () => {
    expect(() => allocate(100, [5000, 4000])).toThrow(/sum to 10000/)
    expect(() => allocate(100, [5000, 5000, 1])).toThrow(/sum to 10000/)
  })

  it('rejects malformed input rather than producing wrong numbers', () => {
    expect(() => allocate(100, [])).toThrow(/at least one weight/)
    expect(() => allocate(-1, [BP_TOTAL])).toThrow(/non-negative/)
    expect(() => allocate(1.5, [BP_TOTAL])).toThrow(/safe integer/)
    expect(() => allocate(100, [6000, 4000.5])).toThrow(/safe integer/)
  })

  it('handles 50/50 with an odd cent without drift', () => {
    // 0.01 split 50/50 — the payer absorbs the odd cent.
    expect(allocate(1, [5000, 5000])).toEqual([1, 0])
    expect(allocate(3, [5000, 5000])).toEqual([2, 1])
  })
})

describe('parseAmountToMinor', () => {
  it('parses whole and two-decimal amounts', () => {
    expect(parseAmountToMinor('12')).toBe(1200)
    expect(parseAmountToMinor('12.3')).toBe(1230)
    expect(parseAmountToMinor('12.34')).toBe(1234)
    expect(parseAmountToMinor('0.05')).toBe(5)
    expect(parseAmountToMinor('  7.01  ')).toBe(701)
  })

  it('accepts a comma as the decimal separator (DE keyboards)', () => {
    expect(parseAmountToMinor('12,34')).toBe(1234)
  })

  it('rejects more than two decimals and junk', () => {
    expect(() => parseAmountToMinor('1.234')).toThrow(/invalid amount/)
    expect(() => parseAmountToMinor('abc')).toThrow(/invalid amount/)
    expect(() => parseAmountToMinor('')).toThrow(/invalid amount/)
    expect(() => parseAmountToMinor('1.2.3')).toThrow(/invalid amount/)
  })
})

describe('formatting', () => {
  it('formats minor units as a plain decimal', () => {
    expect(formatMinor(0)).toBe('0.00')
    expect(formatMinor(5)).toBe('0.05')
    expect(formatMinor(12345)).toBe('123.45')
    expect(formatMinor(-420)).toBe('-4.20')
  })

  it('formats currency and survives a bad currency code', () => {
    expect(formatMoney(12345, 'EUR', 'en')).toContain('123.45')
    // An invalid code must not blank the UI.
    expect(formatMoney(12345, 'NOTACODE', 'en')).toBe('123.45 NOTACODE')
  })
})
