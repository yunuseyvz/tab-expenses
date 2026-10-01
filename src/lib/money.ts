/**
 * Money and split maths. Integer only — no floats anywhere in this path.
 *
 * Amounts are integer minor units (cents). Split weights are integer basis
 * points (bp) that must sum to exactly 10_000.
 */

export const BP_TOTAL = 10_000

/** Basis points → percentage, for display only. */
export function bpToPercent(bp: number): number {
  return bp / 100
}

/**
 * Distribute `amount` minor units across `weights` (basis points) so the
 * shares sum to exactly `amount`, using the largest-remainder method.
 *
 * Ties are broken by ascending index, so the result is deterministic for a
 * given input. Never use this to re-derive a stored share: `share_minor` is
 * computed once at write time and read back verbatim.
 *
 * @throws if weights are negative, or sum to something other than BP_TOTAL.
 */
export function allocate(
  amount: number,
  weights: ReadonlyArray<number>,
): Array<number> {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(
      `amount must be a non-negative safe integer: ${amount}`,
    )
  }
  if (weights.length === 0) {
    throw new RangeError('allocate needs at least one weight')
  }

  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new RangeError(`weight must be a non-negative safe integer: ${w}`)
    }
  }

  const weightSum = weights.reduce((s, w) => s + w, 0)
  if (weightSum !== BP_TOTAL) {
    throw new RangeError(`weights must sum to ${BP_TOTAL}, got ${weightSum}`)
  }

  // Largest-remainder. Products stay well inside safe-integer range for any
  // realistic ledger: amount < 2^53 and weight <= 10_000, but the guard below
  // keeps that assumption honest rather than silent.
  const exact = weights.map((w) => (amount * w) / BP_TOTAL)
  const shares = exact.map((e) => Math.floor(e))
  let leftover = amount - shares.reduce((s, x) => s + x, 0)

  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    // desc by remainder, then asc by index so equal remainders are stable
    .sort((a, b) => b.frac - a.frac || a.i - b.i)

  for (const { i } of order) {
    if (leftover === 0) break
    shares[i] = (shares[i] ?? 0) + 1
    leftover -= 1
  }

  if (leftover !== 0) {
    // Only reachable with more leftover cents than participants, which the
    // weight-sum check above already makes impossible. Fail loudly anyway.
    throw new Error(
      `allocate could not distribute ${leftover} leftover cent(s)`,
    )
  }

  return shares
}

/** Parse a major-unit decimal string ("12.34") into integer minor units. */
export function parseAmountToMinor(input: string): number {
  const trimmed = input.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new RangeError(`invalid amount: ${JSON.stringify(input)}`)
  }
  const [whole = '0', frac = ''] = trimmed.split('.')
  const sign = whole.startsWith('-') ? -1 : 1
  const absWhole = whole.replace('-', '')
  return sign * (Number(absWhole) * 100 + Number(frac.padEnd(2, '0') || 0))
}

/** Format integer minor units for display, e.g. 12345 → "123.45". */
export function formatMinor(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * Format minor units as currency. Falls back to a plain decimal if the runtime
 * rejects the currency code, so a bad `space.currency` can never blank a page.
 */
export function formatMoney(
  amount: number,
  currency: string,
  locale = 'en',
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(amount / 100)
  } catch {
    return `${formatMinor(amount)} ${currency}`
  }
}
