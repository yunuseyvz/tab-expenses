import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type {PeriodPreset} from '#/lib/period';
import { AppShell } from '#/components/AppShell'
import { Card } from '#/components/ui/Card'
import { Button } from '#/components/ui/Button'
import { ExpenseSheet } from '#/components/expense/ExpenseSheet'
import { listCategories, listMembers } from '#/lib/space.functions'
import { expensesQuery } from '#/lib/session'
import { formatMoney } from '#/lib/money'
import {  fromISODate, groupByDay, presetToPeriod } from '#/lib/period'
import { swatchColor } from '#/lib/swatches'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'
import { InlinePeriod } from '#/components/InlinePeriod'

export const Route = createFileRoute('/_protected/expenses')({
  validateSearch: (s: Record<string, unknown>) => ({
    space: typeof s.space === 'string' ? s.space : undefined,
    period: (typeof s.period === 'string' ? s.period : 'all') as PeriodPreset,
    member: typeof s.member === 'string' ? s.member : undefined,
    cats: typeof s.cats === 'string' ? s.cats : undefined,
  }),
  component: ExpensesRoute,
})

function ExpensesRoute() {
  const search = useSearch({ from: '/_protected/expenses' })
  const navigate = useNavigate()
  const { space, spaceId } = useCurrentSpace(search.space)
  const [sheetOpen, setSheetOpen] = useState(false)

  const period = useMemo(() => presetToPeriod(search.period), [search.period])

  const categories = useQuery({
    queryKey: ['spaces', spaceId, 'categories'],
    queryFn: () => listCategories({ data: { spaceId: spaceId! } }),
    enabled: Boolean(spaceId),
  })

  const members = useQuery({
    queryKey: ['spaces', spaceId, 'members'],
    queryFn: () => listMembers({ data: { spaceId: spaceId! } }),
    enabled: Boolean(spaceId),
  })

  const filter = useMemo(
    () => ({
      ...period,
      memberId: search.member ?? null,
      categoryIds: search.cats?.split(',') ?? undefined,
    }),
    [period, search.member, search.cats],
  )

  const expenses = useQuery({
    ...expensesQuery(spaceId ?? '', filter),
    enabled: Boolean(spaceId),
    // Debounce-ish: keep the previous page visible while the next loads, so
    // dragging a filter does not flash an empty screen every frame.
    placeholderData: keepPreviousData,
  })

  const groups = useMemo(() => groupByDay(expenses.data ?? []), [expenses.data])
  const currency = space?.currency ?? 'EUR'

  const go = (
    patch: Partial<{
      space: string | undefined
      period: PeriodPreset
      member: string | undefined
      cats: string | undefined
    }>,
  ) => {
    void navigate({ to: '/expenses', search: { ...search, ...patch } })
  }

  const totalShown = (expenses.data ?? []).reduce((s, e) => s + e.amountMinor, 0)

  return (
    <AppShell>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="font-serif text-2xl sm:text-3xl">Expenses</h1>
            <p className="text-xs text-ink-faint tnum">
              {expenses.data?.length ?? 0} entries ·{' '}
              {formatMoney(totalShown, currency)}
            </p>
          </div>
          <Button onClick={() => setSheetOpen(true)} disabled={!spaceId}>
            New expense
          </Button>
        </div>

        <InlinePeriod
          current={search.period}
          onChange={(nextPeriod) => go({ period: nextPeriod })}
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={search.member ?? ''}
            onChange={(e) => go({ member: e.target.value || undefined })}
            aria-label="Filter by member"
            className="bg-paper-sunk px-2 py-1.5 text-sm rounded-[3px]
              shadow-[var(--shadow-deboss)] focus:outline-none"
          >
            <option value="">Everyone</option>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>

        {expenses.isPending ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing here for this filter.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <section key={g.date}>
                {/* Sticky date header, like a statement. */}
                <div className="sticky top-0 z-10 py-1.5 bg-paper/90 backdrop-blur-sm">
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold">
                      {fromISODate(g.date).toLocaleDateString('en', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}
                    </h2>
                    <span className="tnum text-sm text-ink-muted">
                      {formatMoney(g.totalMinor, currency)}
                    </span>
                  </div>
                </div>

                <Card className="p-0">
                  {g.items.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center gap-3 px-4 py-3 border-b border-rule last:border-b-0"
                    >
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
                        <p className="truncate text-sm font-medium">
                          {e.purpose}
                        </p>
                        <p className="truncate text-xs text-ink-faint">
                          {e.categoryName ?? 'Uncategorised'} · paid by{' '}
                          {e.paidByName}
                          {e.splits.length > 1 &&
                            ` · split ${e.splits.length} ways`}
                        </p>
                      </div>
                      <span className="tnum text-sm font-medium shrink-0">
                        {formatMoney(e.amountMinor, currency)}
                      </span>
                    </div>
                  ))}
                </Card>
              </section>
            ))}
          </div>
        )}

        <ExpenseSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          spaceId={spaceId}
          categories={categories.data ?? []}
          members={members.data ?? []}
          currency={currency}
        />
      </main>
    </AppShell>
  )
}
