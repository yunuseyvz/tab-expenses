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
 * A date range as one short label.
 *
 * "1 Sep – 30 Sep" rather than "1 Sep 2026 – 30 Sep 2026", because this lives
 * in a button that has to stay narrow beside three preset pills. The year
 * appears when the range crosses one, which is the case where dropping it would
 * be actively misleading.
 */
export function rangeLabel(from?: string, to?: string, locale = 'en'): string {
  if (!from && !to) return ''
  const fmt = (iso: string, withYear: boolean) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(fromISODate(iso))

  if (from && to) {
    const sameYear =
      fromISODate(from).getFullYear() === fromISODate(to).getFullYear()
    return sameYear
      ? `${fmt(from, false)} – ${fmt(to, false)} ${fromISODate(to).getFullYear()}`
      : `${fmt(from, true)} – ${fmt(to, true)}`
  }
  return from ? `From ${fmt(from, true)}` : `To ${fmt(to!, true)}`
}
