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

/**
 * The largest amount a ledger will hold, in minor units.
 *
 * Just under the `int4` ceiling of 2 147 483 647, and deliberately so: a cap at
 * the column's own maximum would be enforced by Postgres as an out-of-range
 * error rather than as anything a person could act on, and would leave no room
 * for the column to be widened later.
 *
 * €9 999 999.99 is roughly a hundred thousand years of groceries. It exists to
 * catch a fat finger — a pasted total, a stray keypress of zeroes, a units
 * mistake where cents were typed as major units — and nothing else. A household
 * ledger that genuinely needs more than ten million euros on one line is not a
 * household ledger.
 *
 * The same bound is a check constraint in the schema, because this constant on
 * its own is only reached by whatever happens to call it: a CSV row, an import,
 * a future write path. The column also rejects negatives already
 * (`expense_amount_positive`), so between the two the column is a sane integer.
 */
export const MAX_AMOUNT_MINOR = 999_999_999

/** The same bound as typed into the form, for messages and input attributes. */
export const MAX_AMOUNT = 9_999_999.99

/**
 * Major-unit decimal to minor units, or null if the string is not one.
 *
 * The single place that knows how a typed amount becomes an integer, because two
 * callers need it and they disagree if there are two. `parseAmountToMinor` throws
 * on a bad or oversized value; `isAmountTooLarge` has to tell those two apart.
 * An earlier version of the second one caught everything and returned false,
 * which made "too large" — the only answer it exists to give — unreachable, and
 * the test is what caught that rather than any amount the app would have stored.
 *
 * No bound is applied here; that is the caller's business.
 */
function toMinorOrNull(input: string): number | null {
  const trimmed = input.trim().replace(',', '.')
  if (!/^\d+([.,]\d{1,2})?$/.test(trimmed)) return null
  const [whole = '0', frac = ''] = trimmed.split('.')
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0') || 0)
  return Number.isFinite(minor) ? minor : null
}

/**
 * Parse a major-unit decimal string ("12.34") into integer minor units.
 *
 * Throws `RangeError` past {@link MAX_AMOUNT_MINOR}. Enforced here rather than
 * only in the request validator so every caller is covered — the CSV importer
 * parses amounts through this function and would otherwise be a way around it.
 */
export function parseAmountToMinor(input: string): number {
  const minor = toMinorOrNull(input)
  if (minor === null) {
    throw new RangeError(`invalid amount: ${JSON.stringify(input)}`)
  }
  if (minor > MAX_AMOUNT_MINOR) {
    throw new RangeError(`amount is too large: ${JSON.stringify(input)}`)
  }
  return minor
}

/**
 * Whether a typed amount is over {@link MAX_AMOUNT_MINOR}.
 *
 * Separate from `parseAmountToMinor` because the two answer different questions.
 * Parsing throws, which is right for a write path and wrong for a live field:
 * a form that threw while you typed would either swallow the keystroke or show a
 * stack trace, and the honest thing on screen is a message under the input while
 * the rest of the form stays usable.
 */
export function isAmountTooLarge(input: string): boolean {
  const minor = toMinorOrNull(input)
  // Unparseable is not "too large": the field already calls a malformed or zero
  // amount invalid, and that is a different message about a different mistake.
  return minor !== null && minor > MAX_AMOUNT_MINOR
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
