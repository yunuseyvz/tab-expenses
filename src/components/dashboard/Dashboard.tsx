import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'

import type { Category } from '#/lib/db/schema'
import type { PeriodPreset } from '#/lib/period'
import type { ListFilter } from '#/lib/session'
import { Card, CardHeader, CardTitle, Row, SectionTitle } from '#/components/ui/Card'
import { CategoryChips } from '#/components/dashboard/CategoryChips'
import { CategoryDonut } from '#/components/dashboard/CategoryDonut'
import { balancesQuery, expensesQuery, totalsQuery } from '#/lib/session'
import { formatMoney } from '#/lib/money'
import { swatchColor } from '#/lib/swatches'

/**
 * The dashboard: total spend, your share beside it, the category donut, the
 * filter chips, and recent entries.
 *
 * Selecting a subset of categories updates the headline, the chart, and the
 * list in one pass — the filter is in the query key, so all three read from the
 * same filtered result.
 */
export function Dashboard({
  spaceId,
  currency,
  filter,
  categories,
  allCategoryIds,
  selectedCategoryIds,
  search,
}: {
  spaceId: string | null
  currency: string
  filter: ListFilter
  categories: Array<Category>
  allCategoryIds: Array<string>
  selectedCategoryIds: Array<string> | undefined
  /** current route search, so a filter change preserves the period */
  search: {
    space: string | undefined
    period: PeriodPreset
    cats: string | undefined
    from: string | undefined
    to: string | undefined
  }
}) {
  const navigate = useNavigate()

  const totals = useQuery({
    ...totalsQuery(spaceId ?? '', filter),
    enabled: Boolean(spaceId),
  })

  const recent = useQuery({
    ...expensesQuery(spaceId ?? '', filter),
    enabled: Boolean(spaceId),
  })

  const balances = useQuery({
    ...balancesQuery(spaceId ?? '', filter),
    enabled: Boolean(spaceId),
  })

  // SSR has already warmed these in the route loader, so these resolve from
  // cache on first render. The keys are derived by the same helpers, so they
  // cannot drift apart from what the loader prefetched.

  if (!spaceId) {
    return (
      <p className="text-sm text-ink-muted">Pick a space to see its ledger.</p>
    )
  }

  const setCategories = (next: Array<string> | undefined) => {
    // Merge into the current search so toggling a chip does not silently
    // reset the period back to a preset.
    void navigate({
      to: '/dashboard',
      search: {
        ...search,
        cats: next === undefined ? undefined : next.join(','),
      },
    })
  }

  const yourNet = balances.data?.yourNetMinor ?? 0
  const recentRows = (recent.data ?? []).slice(0, 8)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <SectionTitle>Total spend</SectionTitle>
          <p className="tnum font-serif text-3xl mt-1">
            {totals.isPending
              ? '—'
              : formatMoney(totals.data?.totalMinor ?? 0, currency)}
          </p>
          <p className="text-xs text-ink-faint mt-1 tnum">
            {totals.data?.count ?? 0} entries
          </p>
        </Card>

        <Card>
          <SectionTitle>Your share</SectionTitle>
          <p className="tnum font-serif text-3xl mt-1">
            {totals.isPending
              ? '—'
              : formatMoney(totals.data?.yourShareMinor ?? 0, currency)}
          </p>
          <p
            className="text-xs mt-1 tnum font-medium"
            style={{ color: yourNet >= 0 ? 'var(--color-sage)' : 'var(--color-oxblood)' }}
          >
            {yourNet >= 0 ? 'you are owed ' : 'you owe '}
            {formatMoney(Math.abs(yourNet), currency)}
          </p>
        </Card>
      </div>

      <CategoryChips
        categories={categories}
        allIds={allCategoryIds}
        selected={selectedCategoryIds}
        onChange={setCategories}
      />

      <Card>
        <CardHeader>
          <CardTitle>By category</CardTitle>
        </CardHeader>
        <CategoryDonut
          data={totals.data?.byCategory ?? []}
          currency={currency}
          totalMinor={totals.data?.totalMinor ?? 0}
        />
        <ul className="mt-3 space-y-1.5">
          {(totals.data?.byCategory ?? [])
            .filter((c) => c.totalMinor > 0)
            .map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ background: swatchColor(c.color) }}
                />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="tnum text-ink-muted">
                  {formatMoney(c.totalMinor, currency)}
                </span>
              </li>
            ))}
        </ul>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent entries</CardTitle>
        </CardHeader>
        {recentRows.length === 0 ? (
          <p className="text-sm text-ink-faint py-2">Nothing here yet.</p>
        ) : (
          <div>
            {recentRows.map((e, i) => (
              // Ledger rows stagger in at ~24ms, capped at 8 rows. Beyond that
              // it stops reading as a flourish and starts as a wait.
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: Math.min(i * 0.024, 0.192),
                  type: 'spring',
                  stiffness: 300,
                  damping: 30,
                }}
              >
                <Row>
                  <span
                    aria-hidden
                    className="h-8 w-1 rounded-sm shrink-0"
                    style={{
                      background:
                        e.categoryColor !== null
                          ? swatchColor(e.categoryColor)
                          : 'var(--color-rule)',
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.purpose}</p>
                    <p className="truncate text-xs text-ink-faint tnum">
                      {e.categoryName ?? 'Uncategorised'} · {e.paidByName} ·{' '}
                      {e.spentOn}
                    </p>
                  </div>
                  <span className="tnum text-sm font-medium shrink-0">
                    {formatMoney(e.amountMinor, currency)}
                  </span>
                </Row>
              </motion.div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
