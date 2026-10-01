import { useMemo, useState } from 'react'

import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ExpenseRow } from '#/lib/expense.functions'

import type { PeriodPreset } from '#/lib/period'
import type { ListFilter } from '#/lib/session'
import { AppShell } from '#/components/AppShell'
import { NewExpenseButton } from '#/components/NewExpenseButton'
import { Select } from '#/components/ui/Input'
import { Card } from '#/components/ui/Card'
import { ExpenseSheet } from '#/components/expense/ExpenseSheet'
import { listMySpaces } from '#/lib/auth.functions'
import {
  categoriesQuery,
  expensesQuery,
  membersQuery,
  rememberedSpaceQuery,
  spaceKeys,
} from '#/lib/session'
import { formatMoney } from '#/lib/money'
import { fromISODate, groupByDay, resolvePeriod } from '#/lib/period'
import { swatchColor } from '#/lib/swatches'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'
import { resolveSpaceId } from '#/lib/space-preference'
import { PeriodFilter } from '#/components/PeriodFilter'

export const Route = createFileRoute('/_protected/expenses')({
  validateSearch: (s: Record<string, unknown>) => ({
    space: typeof s.space === 'string' ? s.space : undefined,
    period: (typeof s.period === 'string' ? s.period : 'all') as PeriodPreset,
    member: typeof s.member === 'string' ? s.member : undefined,
    cats: typeof s.cats === 'string' ? s.cats : undefined,
    from: typeof s.from === 'string' ? s.from : undefined,
    to: typeof s.to === 'string' ? s.to : undefined,
  }),
  // Warm the cache so the first paint is the full ledger, not a shell.
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const qc = context.queryClient

    const spaces = await qc.ensureQueryData({
      queryKey: spaceKeys.mySpaces,
      queryFn: () => listMySpaces(),
    })
    const spaceId = resolveSpaceId(
      spaces,
      deps.space,
      await qc.ensureQueryData(rememberedSpaceQuery()),
    )
    if (!spaceId) return

    const period = resolvePeriod(deps.period, deps.from, deps.to)
    const categories = await qc.ensureQueryData(categoriesQuery(spaceId))
    const allIds = categories.map((c: { id: string }) => c.id)

    const filter: ListFilter = {
      ...period,
      memberId: deps.member ?? null,
      categoryIds: deps.cats
        ? deps.cats.split(',').filter((id: string) => allIds.includes(id))
        : undefined,
    }

    await Promise.all([
      qc.ensureQueryData(membersQuery(spaceId)),
      qc.ensureQueryData(expensesQuery(spaceId, filter)),
    ])
  },
  component: ExpensesRoute,
})

function ExpensesRoute() {
  const search = useSearch({ from: '/_protected/expenses' })
  const navigate = useNavigate()
  const { space, spaceId } = useCurrentSpace(search.space)

  const period = useMemo(
    () => resolvePeriod(search.period, search.from, search.to),
    [search.period, search.from, search.to],
  )

  const categories = useQuery({
    ...categoriesQuery(spaceId ?? ''),
    enabled: Boolean(spaceId),
  })

  const members = useQuery({
    ...membersQuery(spaceId ?? ''),
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

  // One sheet for both jobs. `editing === null` means "new"; otherwise the row
  // that was tapped comes with it, already filled in.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<ExpenseRow | null>(null)

  const openNew = () => {
    setEditing(null)
    setSheetOpen(true)
  }
  const openEdit = (row: ExpenseRow) => {
    setEditing(row)
    setSheetOpen(true)
  }

  const go = (
    patch: Partial<{
      space: string | undefined
      period: PeriodPreset
      member: string | undefined
      cats: string | undefined
      from: string | undefined
      to: string | undefined
    }>,
  ) => {
    void navigate({ to: '/expenses', search: { ...search, ...patch } })
  }

  const totalShown = (expenses.data ?? []).reduce(
    (s, e) => s + e.amountMinor,
    0,
  )

  return (
    <AppShell>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl tracking-tight">Expenses</h1>
            <p className="text-xs text-ink-faint tnum">
              {expenses.data?.length ?? 0} entries ·{' '}
              {formatMoney(totalShown, currency)}
            </p>
          </div>
          <NewExpenseButton onClick={openNew} disabled={!spaceId} />
        </div>

        <PeriodFilter
          current={search.period}
          from={search.from}
          to={search.to}
          onChange={(patch) => go(patch)}
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="w-48">
            <Select
              value={search.member ?? ''}
              aria-label="Filter by member"
              onChange={(e) => go({ member: e.target.value || undefined })}
            >
              <option value="">Everyone</option>
              {(members.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </Select>
          </div>
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
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => openEdit(e)}
                      aria-label={`Edit ${e.purpose}, ${formatMoney(e.amountMinor, currency)}`}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left
                        border-b border-rule last:border-b-0
                        transition-colors duration-150 hover:bg-[var(--color-paper-sunk)]"
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
                      <span className="min-w-0 flex-1">
                        <span className="truncate text-sm font-medium block">
                          {e.purpose}
                        </span>
                        <span className="truncate text-xs text-ink-faint block">
                          {e.categoryName ?? 'Uncategorised'} · paid by{' '}
                          {e.paidByName}
                          {e.splits.length > 1 &&
                            ` · split ${e.splits.length} ways`}
                        </span>
                      </span>
                      <span className="tnum text-sm font-medium shrink-0">
                        {formatMoney(e.amountMinor, currency)}
                      </span>
                    </button>
                  ))}
                </Card>
              </section>
            ))}
          </div>
        )}

        <ExpenseSheet
          open={sheetOpen}
          editing={editing}
          onClose={() => {
            setSheetOpen(false)
            setEditing(null)
          }}
          spaceId={spaceId}
          categories={categories.data ?? []}
          members={members.data ?? []}
          currency={currency}
        />
      </main>
    </AppShell>
  )
}
