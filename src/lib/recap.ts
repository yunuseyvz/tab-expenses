/**
 * What last month means, for the comparison on a recap.
 *
 * The honest answer is not "shift both dates back by 31 days" and it is not
 * "same numbers one month earlier" either. Two cases:
 *
 *   A whole month compares against the whole month before it. 30 September is
 *   compared with the whole of August, not with the 31 days ending on
 *   30 August — the question is "was August busier", and both sides should be
 *   whole months or the answer is about the length of the month.
 *
 *   A part-month compares with the same part of the month before. On 4 October
 *   the useful comparison is 1-4 September, because "so far" and "all of last
 *   month" is a comparison that is guaranteed to say spending has fallen.
 *
 * Pure, and tested at both boundaries, because an off-by-one here produces a
 * number that looks entirely plausible and is wrong by a day's spending.
 */
import { daysInMonth } from './period'

export interface Window {
  from: string
  to: string
}

function parse(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { y: y!, m: m!, d: d! }
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** The month before the one `iso` falls in. */
function monthBefore(isoDate: string): { y: number; m: number } {
  const { y, m } = parse(isoDate)
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
}

/**
 * Whether a range is a complete calendar month, which is what decides whether
 * the comparison is a whole month or the same part of one.
 */
export function isWholeMonth(from: string, to: string): boolean {
  const f = parse(from)
  const t = parse(to)
  return (
    f.d === 1 && t.d === daysInMonth(t.y, t.m) && f.y === t.y && f.m === t.m
  )
}

/**
 * The window to compare `from`-`to` against: the same span one month earlier.
 *
 * A whole month maps to the whole previous month. Anything else maps to the
 * first `n` days of the previous month, where `n` is how far into the month the
 * range reaches — clamped, because 31 March has no counterpart in February.
 */
export function previousWindow(from: string, to: string): Window {
  const prev = monthBefore(from)

  if (isWholeMonth(from, to)) {
    return {
      from: iso(prev.y, prev.m, 1),
      to: iso(prev.y, prev.m, daysInMonth(prev.y, prev.m)),
    }
  }

  const day = parse(to).d
  return {
    from: iso(prev.y, prev.m, 1),
    to: iso(prev.y, prev.m, Math.min(day, daysInMonth(prev.y, prev.m))),
  }
}

/**
 * Percentage change, or null when there is nothing to compare against.
 *
 * Null rather than "up 100%" for a first month: a household with no August has
 * not doubled its spending in September, it has started. Zero-versus-zero is
 * null too — there is no change to report, and "0% more" invites the reader to
 * look for the number that is not there.
 */
export function changePercent(
  current: number,
  previous: number,
): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}
