import type { Period } from './period'

/**
 * The calendar grid, as a pure function.
 *
 * Kept out of the component so the awkward parts are directly testable: which
 * days belong to a month, where the grid starts, and what happens around a
 * month boundary. Getting any of that wrong is invisible in a screenshot and
 * very obvious to a user who clicks near an edge.
 *
 * All dates are local-time `Date` objects at midnight. The app stores
 * `spent_on` as a DATE column and sends ISO `YYYY-MM-DD` strings; anything that
 * let a UTC date slip in here would shift an expense by a day for anyone east
 * or west of Greenwich.
 */

/** Monday-first, because that is the convention in most of Europe. */
export const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const
export const WEEKDAYS_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

/** Monday=0 … Sunday=6. */
function weekdayIndex(d: Date) {
  return (d.getDay() + 6) % 7
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function addMonths(d: Date, delta: number): Date {
  // Set the day to 1 before shifting. new Date(2026, 0, 31) then -1 month would
  // otherwise roll forward into March, because February has no 31st.
  return new Date(d.getFullYear(), d.getMonth() + delta, 1)
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function toISODate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export interface CalendarCell {
  date: Date
  iso: string
  /** False for the leading/trailing days borrowed from the neighbours. */
  inMonth: boolean
  isToday: boolean
}

/**
 * Six weeks of days covering `month`, Monday-first.
 *
 * Always 42 cells. A five-week grid looks tighter but changes height between
 * months, which makes the popover jump as you page through — six rows keeps it
 * still, which matters more than saving one row.
 */
export function monthGrid(
  month: Date,
  today = new Date(),
): Array<CalendarCell> {
  const first = startOfMonth(month)
  const leading = weekdayIndex(first)
  const cells: Array<CalendarCell> = []

  for (let i = 0; i < 42; i++) {
    const date = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate() - leading + i,
    )
    cells.push({
      date,
      iso: toISODate(date),
      inMonth: date.getMonth() === first.getMonth(),
      isToday: isSameDay(date, today),
    })
  }
  return cells
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function monthLabel(d: Date, locale = 'en') {
  // Intl gives "September 2026" for 'en' but a differently cased short form for
  // other locales, which is what a person's own calendar would show them.
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
    }).format(d)
  } catch {
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
  }
}

/**
 * Compact form for a closed field.
 *
 * The long form ("Wed, 30 Sep 2026") is right for the trigger only when there is
 * room for it, and the date field sits in a two-column grid next to the category
 * picker, so it does not have room. The full weekday stays in aria-label, so
 * nothing is actually lost for a screen reader.
 */
export function shortDate(iso: string, locale = 'en'): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(fromISODate(iso))
  } catch {
    return iso
  }
}

export function longDate(iso: string, locale = 'en'): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(fromISODate(iso))
  } catch {
    return iso
  }
}

/**
 * The month a calendar view of `period` should open on.
 *
 * The calendar is a rendering of the current filter, not a second filter of its
 * own, so the month it shows has to come from somewhere — and the only honest
 * source is the period itself. A bounded period names its own month: the month
 * of `from`, the anchor a person picked first, falling back to `to` only when
 * the start is open. An unbounded one names no month at all, and today's is the
 * only month that never surprises.
 *
 * A range that spans a month boundary (Last week over one, or a hand-typed
 * Custom range) still resolves to a single month, because a calendar can only
 * show one — and the *start* is where the reading began.
 */
export function periodMonth(period: Period, today = new Date()): Date {
  const anchor = period.from ?? period.to
  return anchor ? startOfMonth(fromISODate(anchor)) : startOfMonth(today)
}
