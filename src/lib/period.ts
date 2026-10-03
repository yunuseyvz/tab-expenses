/**
 * Period selection shared by the dashboard and the expenses list.
 *
 * Dates are plain `YYYY-MM-DD` strings in the space's local calendar. Time
 * zones are deliberately not modelled in v1: a household ledger records the
 * day something happened, not an instant, and a date-only column avoids an
 * entire class of off-by-one-day bugs at the cost of nothing real.
 */

export type PeriodPreset =
  | 'thisWeek'
  | 'lastWeek'
  | 'thisBiweek'
  | 'lastBiweek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'all'
  | 'custom'

/**
 * The presets, as data rather than as a switch.
 *
 * Two reasons this exists. The Settings screen needs the label for every option,
 * and a list written there as well as in the switch above is two lists that
 * drift. And `z.enum` needs a tuple it can be built from, which a `switch`
 * statement cannot provide — so without this the server would validate the
 * household's cycle against a hand-copied array of the same names.
 */
export const PERIOD_PRESETS = [
  { key: 'thisWeek', label: 'This week' },
  { key: 'lastWeek', label: 'Last week' },
  { key: 'thisBiweek', label: 'This fortnight' },
  { key: 'lastBiweek', label: 'Last fortnight' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'thisQuarter', label: 'This quarter' },
  { key: 'all', label: 'All' },
] as const satisfies ReadonlyArray<{ key: PeriodPreset; label: string }>

/** Only the *bounded* ones — the cycles a household can settle on. */
export const CYCLE_KEYS = [
  'thisWeek',
  'thisBiweek',
  'thisMonth',
  'thisQuarter',
] as const satisfies ReadonlyArray<PeriodPreset>

export type CycleKey = (typeof CYCLE_KEYS)[number]

/** The tuple `z.enum` needs. */
export const CYCLE_KEY_TUPLE = CYCLE_KEYS as unknown as [
  CycleKey,
  ...Array<CycleKey>,
]

/**
 * Narrow an untrusted string to a settlement cycle.
 *
 * The household's cycle is a text column, so it arrives as `string`, and a value
 * written by another version of the app may not be one this build knows.
 * Anything unrecognised becomes `undefined` rather than a guess, and that is the
 * whole point: an unrecognised key reaching `presetToPeriod` matches no `case`
 * and produces no bounds, which is "all time" — a household that settles
 * fortnightly quietly looking at its entire history with nothing indicating that
 * anything went wrong.
 *
 * Deliberately narrower than "is this a preset". `all` and `custom` are real
 * presets and `presetToPeriod` handles both, but neither is a cadence anybody
 * settles on, so neither is a valid value for this column. Narrowing against
 * CYCLE_KEYS rather than against a hand-written list is what keeps the Settings
 * control and the reader in agreement.
 */
export function asCycleKey(
  value: string | null | undefined,
): CycleKey | undefined {
  return CYCLE_KEYS.find((k) => k === value)
}

export function cycleLabel(key: string): string {
  return PERIOD_PRESETS.find((p) => p.key === key)?.label ?? 'This month'
}

export interface Period {
  from: string | null // null = unbounded
  to: string | null // null = unbounded
}

export function today(): string {
  return toISODate(new Date())
}

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** Sunday, matching `getDay()`'s 0. */
export function startOfWeek(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay())
}

export function endOfWeek(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (6 - d.getDay()))
}

/**
 * The fortnight containing `d`, as a half-open [start, start + 14 days) span.
 *
 * ALIGNED TO THE CALENDAR, not "the last 14 days". A rolling window slides by a
 * day every time you look at it, so two people opening the app on different days
 * see different weeks and consecutive cycles overlap — which is worse than
 * useless for a ledger whose whole point is that a fortnight is the unit you
 * settle over. Anchoring to Sunday means every fortnight in the app is the same
 * fortnight for everybody, and two adjacent ones tile with no gap and no overlap.
 *
 * Half-open on purpose: `addDays(start, 14)` is the first day of the *next*
 * fortnight, so the period is `from` up to but not including it. That is what
 * makes `nextPeriod` a one-liner and what stops an expense on the boundary
 * appearing in two cycles.
 */
export function startOfBiweek(d: Date): Date {
  const weekStart = startOfWeek(d)
  const weeksIn = Math.floor((weekStart.getTime() - EPOCH.getTime()) / WEEK_MS)
  const cycle = Math.floor(weeksIn / 2)
  return new Date(EPOCH.getTime() + cycle * 2 * WEEK_MS)
}

/**
 * A fixed Sunday, so every fortnight boundary in the app agrees.
 *
 * Any Sunday would do as long as it never moves; an arbitrary one would make the
 * arithmetic depend on whichever day the code happened to start counting from.
 * 1970-01-04 was a Sunday, and it is early enough that no plausible date
 * subtracts into the year 0.
 */
const EPOCH = new Date(1970, 0, 4)
const WEEK_MS = 7 * 86_400_000

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

export function startOfQuarter(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
}

export function endOfQuarter(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0)
}

/** A whole cycle earlier than the one containing `d`. */
function backCycles(d: Date, weeks: number): Date {
  if (weeks === 1) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7)
  }
  if (weeks === 2) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 14)
  }
  if (weeks === 3) {
    return new Date(d.getFullYear(), d.getMonth() - 3, 1)
  }
  return new Date(d.getFullYear(), d.getMonth() - 1, 1)
}

export function presetToPeriod(preset: PeriodPreset): Period {
  const now = new Date()
  switch (preset) {
    case 'thisWeek':
      return {
        from: toISODate(startOfWeek(now)),
        to: toISODate(endOfWeek(now)),
      }
    case 'lastWeek': {
      const prev = backCycles(now, 1)
      return {
        from: toISODate(startOfWeek(prev)),
        to: toISODate(endOfWeek(prev)),
      }
    }
    case 'thisBiweek': {
      const start = startOfBiweek(now)
      return {
        from: toISODate(start),
        // Inclusive last day, so the range reads as a fortnight of dates rather
        // than as a half-open interval nobody outside this file would guess at.
        to: toISODate(new Date(start.getTime() + 13 * 86_400_000)),
      }
    }
    case 'lastBiweek': {
      const start = new Date(startOfBiweek(now).getTime() - 14 * 86_400_000)
      return {
        from: toISODate(start),
        to: toISODate(new Date(start.getTime() + 13 * 86_400_000)),
      }
    }
    case 'thisQuarter':
      return {
        from: toISODate(startOfQuarter(now)),
        to: toISODate(endOfQuarter(now)),
      }
    case 'thisMonth':
      return {
        from: toISODate(startOfMonth(now)),
        to: toISODate(endOfMonth(now)),
      }
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      return {
        from: toISODate(startOfMonth(first)),
        to: toISODate(endOfMonth(first)),
      }
    }
    case 'all':
    case 'custom':
      return { from: null, to: null }
    default:
      // Reachable, and the reason this function is not simply trusted to be
      // exhaustive. `PeriodPreset` comes off a URL search param that the routes
      // cast without checking (`s.period as PeriodPreset`), so a hand-typed
      // `?period=lastQuarter` arrives here as a string the type system insists is
      // a preset. With no `default`, the switch fell off the end and returned
      // `undefined` — from a function declared to return `Period`, which the
      // compiler had no reason to doubt.
      //
      // That `undefined` then reached `periodLabel(period)` on the dashboard and
      // threw `Cannot read properties of undefined (reading 'from')`, taking the
      // whole screen down over a query string.
      //
      // "No bounds" is the honest answer and is what this function already
      // returns for `all`: a preset nobody recognises resolves to no window, and
      // the screen shows everything, which is what the caller asked for by
      // naming something that does not exist. `asCycleKey` is what narrows the
      // *settlement cycle*, where an unrecognised value must not silently become
      // a cadence.
      return { from: null, to: null }
  }
}

/**
 * The period a screen should actually query.
 *
 * `presetToPeriod` maps a preset to dates, and 'custom' deliberately falls
 * through to "no bounds" — so it must never be called on its own with a custom
 * range. The expenses screen was doing exactly that: it accepted `from` and
 * `to`, then computed its filter from `presetToPeriod(deps.period)` and threw
 * them away, so choosing Custom silently showed all time. One function so a
 * loader and its component cannot disagree about which dates a screen shows.
 *
 * Total by construction: it cannot return `undefined`, whatever it is handed.
 * See the `default` in `presetToPeriod` for why that is not a formality.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  from?: string,
  to?: string,
): Period {
  if (preset === 'custom') {
    return { from: from ?? null, to: to ?? null }
  }
  return presetToPeriod(preset)
}

/**
 * What the period control calls itself.
 *
 * The preset's own name where one exists, and the resolved dates where none does.
 *
 * Three cases are not preset names. `all` and `custom` name the *mechanism* —
 * "All" and "Custom range" say which of the nine you picked, not what dates you
 * ended up looking at — so both describe the window instead. And a preset this
 * build does not recognise reaches here from the URL, which casts the search
 * param without checking it. `resolvePeriod` gives such a key no bounds, because
 * it matches no case in `presetToPeriod`, so "All time" is not a guess here: it
 * is what the loader fetched with.
 *
 * That last case is the reason this falls back rather than returning
 * `PERIOD_PRESETS.find(...)?.label`. The first version did exactly that, and a
 * hand-typed `?period=lastQuarter` produced a button with a calendar icon, a
 * chevron, and no text between them.
 */
export function periodControlLabel(
  preset: PeriodPreset,
  from?: string,
  to?: string,
  locale = 'en',
): string {
  if (preset === 'all' || preset === 'custom') {
    return periodLabel(resolvePeriod(preset, from, to), locale)
  }
  return (
    PERIOD_PRESETS.find((p) => p.key === preset)?.label ??
    periodLabel(resolvePeriod(preset, from, to), locale)
  )
}

export function periodLabel(period: Period, locale = 'en'): string {
  const fmt = (s: string) =>
    fromISODate(s).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  if (period.from && period.to) {
    return period.from === period.to
      ? fmt(period.from)
      : `${fmt(period.from)} – ${fmt(period.to)}`
  }
  if (period.from) return `from ${fmt(period.from)}`
  if (period.to) return `until ${fmt(period.to)}`
  return 'All time'
}

export interface DayBucket {
  date: string
  totalMinor: number
  count: number
}

/**
 * Group expenses into day buckets, newest first, preserving input order
 * within a day. Sorted by date descending so the ledger reads like a
 * statement.
 */
export function groupByDay<T extends { spentOn: string; amountMinor: number }>(
  expenses: ReadonlyArray<T>,
): Array<{ date: string; items: Array<T>; totalMinor: number }> {
  const byDate = new Map<string, Array<T>>()
  for (const e of expenses) {
    const list = byDate.get(e.spentOn)
    if (list) list.push(e)
    else byDate.set(e.spentOn, [e])
  }

  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => ({
      date,
      items,
      totalMinor: items.reduce((s, i) => s + i.amountMinor, 0),
    }))
}
