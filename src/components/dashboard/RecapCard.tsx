/**
 * The month in review: the only card in the app that looks backwards.
 *
 * Everything else here is a control or a figure you act on. This one is for
 * reading, so it is allowed to be a paragraph of numbers rather than a row of
 * buttons — and it is the one place where being interesting beats being terse.
 *
 * It appears only when the period has two ends. "All time in review" is not a
 * review and has no month to compare against, so the card simply is not there;
 * no empty state, because there is nothing to be empty about.
 *
 * The comparison is the part worth getting right. A whole month is compared with
 * the whole month before it, and a part month with the same days of the month
 * before — never "this month so far" against "all of last month", which would
 * announce a fall in spending every single time the page was opened on the 2nd.
 * See `previousWindow`.
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

import type { Period } from '#/lib/period'
import { Card, CardHeader, CardTitle } from '#/components/ui/Card'
import { recapQuery } from '#/lib/session'
import { formatMoney } from '#/lib/money'
import { swatchColor } from '#/lib/swatches'

export function RecapCard({
  spaceId,
  currency,
  filter,
}: {
  spaceId: string | null
  currency: string
  filter: Period
}) {
  const recap = useQuery({
    ...recapQuery(spaceId ?? '', filter),
    enabled: Boolean(spaceId) && Boolean(filter.from) && Boolean(filter.to),
  })

  const data = recap.data
  // Nothing worth reviewing: an empty month is not a story, and a card of zeros
  // would take up the space of the entries that are not there.
  if (!data || data.count === 0) return null

  const from = filter.from!
  const monthLabel = new Date(`${from}T00:00:00`).toLocaleDateString('en', {
    month: 'long',
    year: 'numeric',
  })

  const change = data.changePercent
  const rising = change !== null && change > 0
  const falling = change !== null && change < 0
  // Up is not good news here. Spending more is the one direction this number can
  // move that a household does not want, which is the opposite of the balance
  // colours elsewhere — so the arrow carries the meaning and the colour agrees
  // with the arrow rather than with the word "up".
  const changeColor = rising
    ? 'var(--color-oxblood)'
    : falling
      ? 'var(--color-sage)'
      : 'var(--color-ink-faint)'
  const ChangeIcon = rising ? ArrowUpRight : falling ? ArrowDownRight : Minus

  return (
    <Card>
      <CardHeader>
        <CardTitle>Month in review</CardTitle>
      </CardHeader>

      <div className="pt-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="tnum text-2xl">
            {formatMoney(data.totalMinor, currency)}
          </span>
          {change !== null ? (
            <span
              className="inline-flex items-center gap-0.5 text-xs font-medium tnum"
              style={{ color: changeColor }}
            >
              <ChangeIcon size={14} aria-hidden />
              {Math.abs(change)}%
              <span className="text-ink-faint font-normal">
                {data.wholeMonth ? 'vs last month' : 'vs this point last month'}
              </span>
            </span>
          ) : (
            <span className="text-xs text-ink-faint">
              {data.wholeMonth
                ? 'nothing at all last month'
                : 'nothing by this point last month'}
            </span>
          )}
        </div>
        <p className="text-xs text-ink-faint mt-1 tnum">
          {monthLabel} · {data.count} {data.count === 1 ? 'entry' : 'entries'}
        </p>

        {/* The three questions a ledger does not answer on its own: what was the
            biggest thing, what did we spend most on, and who has been carrying
            it. Each is a row of label and answer, so the eye can skip down the
            left column and stop at the one it cares about. */}
        <dl className="mt-4 space-y-2.5">
          {data.biggest && (
            <Highlight label="Biggest" value={data.biggest.label}>
              {formatMoney(data.biggest.amountMinor, currency)}
            </Highlight>
          )}
          {data.topCategory && (
            <Highlight
              label="Most spent on"
              value={data.topCategory.label}
              dot={swatchColor(data.topCategory.color ?? 'slate')}
            >
              {formatMoney(data.topCategory.amountMinor, currency)}
            </Highlight>
          )}
          {data.topPayer && (
            <Highlight label="Paid the most" value={data.topPayer.label}>
              {formatMoney(data.topPayer.amountMinor, currency)}
            </Highlight>
          )}
        </dl>
      </div>
    </Card>
  )
}

function Highlight({
  label,
  value,
  dot,
  children,
}: {
  label: string
  value: string
  dot?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <dt className="w-[6.5rem] shrink-0 text-xs uppercase tracking-wide text-ink-faint">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 flex items-baseline gap-2">
        {dot && (
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full shrink-0 self-center"
            style={{ background: dot }}
          />
        )}
        <span className="truncate">{value}</span>
        <span className="ml-auto tnum shrink-0 text-ink-muted">{children}</span>
      </dd>
    </div>
  )
}
