import { useMemo, useState } from 'react'
import {
  createFileRoute,
  useNavigate,
  useRouteContext,
  useSearch,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import type { ExpenseRow } from '#/lib/expense.functions'
import type { ListFilter } from '#/lib/session'
import type { PeriodPreset } from '#/lib/period'
import { AppShell } from '#/components/AppShell'
import { DashboardHeader } from '#/components/DashboardHeader'
import { Dashboard } from '#/components/dashboard/Dashboard'
import { ExpenseSheet } from '#/components/expense/ExpenseSheet'
import { PeriodFilter } from '#/components/PeriodFilter'
import { listMySpaces } from '#/lib/auth.functions'
import {
  balancesQuery,
  categoriesQuery,
  expensesQuery,
  membersQuery,
  rememberedSpaceQuery,
  spaceKeys,
  totalsQuery,
} from '#/lib/session'
import { periodLabel, resolvePeriod } from '#/lib/period'
import { resolveSpaceId } from '#/lib/space-preference'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'

export const Route = createFileRoute('/_protected/dashboard')({
  validateSearch: (s: Record<string, unknown>) => ({
    space: typeof s.space === 'string' ? s.space : undefined,
    // Undefined means "the default" rather than a fixed month. The component
    // resolves it to this month; see the note in balances.tsx.
    period:
      typeof s.period === 'string' ? (s.period as PeriodPreset) : undefined,
    cats: typeof s.cats === 'string' ? s.cats : undefined,
    from: typeof s.from === 'string' ? s.from : undefined,
    to: typeof s.to === 'string' ? s.to : undefined,
  }),
  // Prefetch everything the screen renders. This is what makes the SSR response
  // complete markup instead of a suspended shell: the component's useQuery
  // reads from a cache that is already warm on the server.
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

    // A custom range wins over the preset; the two coexist in the URL so
    // switching back to a preset does not discard the custom dates.
    const period = resolvePeriod(deps.period ?? 'thisMonth', deps.from, deps.to)

    const categories = await qc.ensureQueryData(categoriesQuery(spaceId))
    const allIds = categories.map((c: { id: string }) => c.id)
    const categoryIds =
      deps.cats === undefined
        ? undefined
        : deps.cats.split(',').filter((id: string) => allIds.includes(id))

    const filter: ListFilter = { ...period, categoryIds }

    // Keys must match the component's useQuery exactly, including the balances
    // key which uses the same filter object even though it only reads from/to —
    // a mismatched key is a cache miss and a blank first paint.
    await Promise.all([
      qc.ensureQueryData(membersQuery(spaceId)),
      qc.ensureQueryData(expensesQuery(spaceId, filter)),
      qc.ensureQueryData(totalsQuery(spaceId, filter)),
      qc.ensureQueryData(balancesQuery(spaceId, filter)),
    ])
  },
  component: DashboardRoute,
})

function DashboardRoute() {
  const search = useSearch({ from: '/_protected/dashboard' })
  const navigate = useNavigate()
  const { space, spaceId } = useCurrentSpace(search.space)
  // One sheet for new and edit, exactly as on the expenses list.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<ExpenseRow | null>(null)

  const openNew = () => {
    setEditing(null)
    setSheetOpen(true)
  }
  /**
   * Always opens, same as the expenses list: a read-only entry is still
   * viewable, with the reason stated inside the sheet.
   */
  const openEdit = (row: ExpenseRow) => {
    setEditing(row)
    setSheetOpen(true)
  }

  // Already resolved for the route guard, so reading it from context is free
  // rather than a second round trip.
  const { user } = useRouteContext({ from: '/_protected' })

  // The URL, else this month. See the note in balances.tsx: a settlement cycle
  // was tried here and reverted.
  const effectivePreset = search.period ?? 'thisMonth'
  const period = useMemo(
    () => resolvePeriod(effectivePreset, search.from, search.to),
    [effectivePreset, search.from, search.to],
  )

  const categories = useQuery({
    ...categoriesQuery(spaceId ?? ''),
    enabled: Boolean(spaceId),
  })

  const members = useQuery({
    ...membersQuery(spaceId ?? ''),
    enabled: Boolean(spaceId),
  })

  // `cats` undefined means "no category filter"; an empty string means "the
  // user deselected everything", which is a real, empty selection.
  const allIds = useMemo(
    () => (categories.data ?? []).map((c) => c.id),
    [categories.data],
  )
  const selectedIds = useMemo(() => {
    if (search.cats === undefined) return undefined
    return search.cats.split(',').filter((id) => allIds.includes(id))
  }, [search.cats, allIds])

  const filter = useMemo(
    () => ({ ...period, categoryIds: selectedIds }),
    [period, selectedIds],
  )

  return (
    <AppShell>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
        {/* The greeting, the app's mark and the reader's avatar, in place of the
            mobile top bar that used to sit above this. The period label is
            passed in already resolved so this line and the filter below it can
            never describe different windows. */}
        <DashboardHeader
          user={user}
          spaceName={space?.name}
          currency={space?.currency}
          periodLabel={periodLabel(period)}
          onNewExpense={openNew}
          newDisabled={!spaceId}
        />

        <PeriodFilter
          current={effectivePreset}
          from={search.from}
          to={search.to}
          onChange={(patch) =>
            navigate({ to: '/dashboard', search: { ...search, ...patch } })
          }
        />

        <Dashboard
          spaceId={spaceId}
          currency={space?.currency ?? 'EUR'}
          filter={filter}
          categories={categories.data ?? []}
          allCategoryIds={allIds}
          selectedCategoryIds={selectedIds}
          // The resolved preset, not the raw URL param: Dashboard reads this
          // back when a filter change re-navigates, and passing the undefined
          // through would drop the default from the very next link it builds.
          search={{ ...search, period: effectivePreset }}
          onEdit={openEdit}
        />

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
          currency={space?.currency ?? 'EUR'}
        />
      </main>
    </AppShell>
  )
}
