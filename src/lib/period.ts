/**
 * Period selection shared by the dashboard and the expenses list.
 *
 * Dates are plain `YYYY-MM-DD` strings in the space's local calendar. Time
 * zones are deliberately not modelled in v1: a household ledger records the
 * day something happened, not an instant, and a date-only column avoids an
 * entire class of off-by-one-day bugs at the cost of nothing real.
 */

export type PeriodPreset = 'thisMonth' | 'lastMonth' | 'all' | 'custom'

/**
 * The presets, as data rather than as a switch.
 *
 * So the filter component and the period tests read the same list the server
 * resolves against — two hand-written lists of the same names drift, and a
 * preset that exists in one but not the other is a button that shows a label and
 * then displays the wrong dates.
 *
 * `custom` is NOT in here. It is a real preset and `presetToPeriod` handles it,
 * but it is not a *range*: it means "use the two dates in the URL", so it belongs
 * to the control as the entry that reveals the date fields rather than to the
 * list of ranges you can pick from.
 */
export const PERIOD_PRESETS = [
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'all', label: 'All' },
] as const satisfies ReadonlyArray<{ key: PeriodPreset; label: string }>

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

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

export function presetToPeriod(preset: PeriodPreset): Period {
  const now = new Date()
  switch (preset) {
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
      // whole screen down over a query string. Kept through the revert below: it
      // has nothing to do with settlement cycles.
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
