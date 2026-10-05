/**
 * When a repeating expense is next due, and which occurrence it is.
 *
 * Pure date maths, no DB and no server-only imports, so it is directly
 * testable — and it needs to be, because this is where a series silently
 * drifts. "Add one month" is the operation everybody writes wrong once: step
 * from Jan 31 and you get Feb 28 (or Mar 3, depending on the runtime), and if
 * that becomes the new starting point then February permanently changed the
 * schedule. Rent due on the 31st is due on the 31st again in March.
 *
 * So there are two ideas here and they are separate:
 *
 *   - The ANCHOR is the day of the month the series was set up on, and it never
 *     moves. It is what makes "the 31st" mean the 31st again.
 *   - The CURSOR is the next occurrence to create, and it does get clamped by
 *     short months. It is only ever a date to check, not a rule to follow.
 *
 * Everything is `YYYY-MM-DD` in the server's local calendar, matching `spentOn`
 * and `settledOn` everywhere else.
 */
import { daysInMonth, toISODate } from './period'

export type Frequency = 'monthly' | 'weekly'

/** Clamped, so a long-running catch-up cannot loop forever on a bad cursor. */
const MAX_OCCURRENCES_PER_READ = 120

function parse(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { y: y!, m: m!, d: d! }
}

/** The anchor day of an ISO date — 31 for '2026-01-31'. */
export function anchorDayOf(iso: string): number {
  return parse(iso).d
}

/**
 * The next occurrence strictly after `from`, keeping the anchor day.
 *
 * Weekly simply adds seven days. Monthly lands on the anchor day of the
 * following month, clamped to that month's length — so a series anchored on the
 * 31st gives Jan 31, Feb 28, Mar 31, Apr 30, and never drifts to the 28th for
 * good.
 */
export function nextOccurrence(
  from: string,
  frequency: Frequency,
  anchorDay: number,
): string {
  const { y, m, d } = parse(from)

  if (frequency === 'weekly') {
    const next = new Date(y, m - 1, d + 7)
    return toISODate(next)
  }

  const nextMonth = m === 12 ? 1 : m + 1
  const nextYear = m === 12 ? y + 1 : y
  const day = Math.min(anchorDay, daysInMonth(nextYear, nextMonth))
  return toISODate(new Date(nextYear, nextMonth - 1, day))
}

/**
 * Which occurrence of the series a date is.
 *
 * Monthly keys are `YYYY-MM` because a monthly series has exactly one occurrence
 * per calendar month, whatever day of it the anchor lands on — so the month IS
 * the identity. Weekly keys are the ISO week, `YYYY-Www`, for the same reason.
 *
 * The key is what the unique index is on, so this function is what stops a
 * second read from creating the same rent twice.
 */
export function periodKey(frequency: Frequency, iso: string): string {
  const { y, m, d } = parse(iso)
  if (frequency === 'monthly') return `${y}-${String(m).padStart(2, '0')}`

  const { year, week } = isoWeek(y, m, d)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * ISO-8601 week number: weeks start Monday, and week 1 is the week containing
 * the first Thursday of the year — which is what makes late December belong to
 * the next year's week 1 rather than to a week 53 that does not exist.
 *
 * Written out rather than reached for in a library because the failure is
 * cosmetic-but-wrong: two occurrences of a weekly series sharing a key would be
 * silently dropped as duplicates, and a week-53 boundary is exactly where that
 * would happen. The tests walk the boundaries.
 */
function isoWeek(
  y: number,
  m: number,
  d: number,
): { year: number; week: number } {
  const date = new Date(Date.UTC(y, m - 1, d))
  // Shift to the Thursday of this week: the ISO year is the year that Thursday
  // falls in, and the week number is how many Thursdays have passed.
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const year = date.getUTCFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  )
  return { year, week }
}

export interface Occurrence {
  date: string
  key: string
}

/**
 * Every occurrence due on or before `today`, starting from the cursor and
 * stopping at the first one that is not due yet.
 *
 * Returns the occurrences AND the cursor to store, because they have to be
 * written together: an occurrence created without advancing the cursor would be
 * attempted again on the next read (harmless, the unique index refuses it, but
 * wasteful forever), and a cursor advanced without creating them loses a month.
 *
 * The catch-up is the point. A container that was down on the 1st has missed
 * nothing: the next read walks forward as far as it needs to.
 */
export function dueOccurrences(
  nextDueOn: string,
  frequency: Frequency,
  anchorDay: number,
  today: string,
): { due: Array<Occurrence>; cursor: string } {
  const due: Array<Occurrence> = []
  let cursor = nextDueOn
  let guard = 0

  while (cursor <= today && guard++ < MAX_OCCURRENCES_PER_READ) {
    due.push({ date: cursor, key: periodKey(frequency, cursor) })
    cursor = nextOccurrence(cursor, frequency, anchorDay)
  }

  return { due, cursor }
}
