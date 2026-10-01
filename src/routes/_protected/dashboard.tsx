import { useMemo, useState } from 'react'
import { createFileRoute, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'

import type {PeriodPreset} from '#/lib/period';
import { AppShell } from '#/components/AppShell'
import { Dashboard } from '#/components/dashboard/Dashboard'
import { ExpenseSheet } from '#/components/expense/ExpenseSheet'
import { PeriodSelector } from '#/components/dashboard/PeriodSelector'
import { Button } from '#/components/ui/Button'
import { listMySpaces } from '#/lib/auth.functions'
import { listCategories, listMembers } from '#/lib/space.functions'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'
import {  periodLabel, presetToPeriod } from '#/lib/period'

export const Route = createFileRoute('/_protected/dashboard')({
  validateSearch: (s: Record<string, unknown>) => ({
    space: typeof s.space === 'string' ? s.space : undefined,
    period: (typeof s.period === 'string' ? s.period : 'thisMonth') as PeriodPreset,
    cats: typeof s.cats === 'string' ? s.cats : undefined,
    from: typeof s.from === 'string' ? s.from : undefined,
    to: typeof s.to === 'string' ? s.to : undefined,
  }),
  loader: () => listMySpaces(),
  component: DashboardRoute,
})

function DashboardRoute() {
  const search = useSearch({ from: '/_protected/dashboard' })
  const { space, spaceId } = useCurrentSpace(search.space)
  const [sheetOpen, setSheetOpen] = useState(false)

  // A custom range wins over the preset; the two coexist in the URL so
  // switching back to a preset does not discard the custom dates.
  const period = useMemo(
    () =>
      search.period === 'custom'
        ? { from: search.from ?? null, to: search.to ?? null }
        : presetToPeriod(search.period),
    [search.period, search.from, search.to],
  )

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

  // `cats` undefined means "no category filter"; an empty string means
  // "the user deselected everything", which is a real, empty selection.
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
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="font-serif text-2xl sm:text-3xl">
              {space?.name ?? 'Dashboard'}
            </h1>
            <p className="text-xs text-ink-faint tnum">
              {space?.currency} · {periodLabel(period)}
            </p>
          </div>
          <Button onClick={() => setSheetOpen(true)} disabled={!spaceId}>
            <Plus size={16} aria-hidden />
            New expense
          </Button>
        </div>

        <PeriodSelector
          current={search.period}
          from={search.from}
          to={search.to}
        />

        <Dashboard
          spaceId={spaceId}
          currency={space?.currency ?? 'EUR'}
          filter={filter}
          categories={categories.data ?? []}
          allCategoryIds={allIds}
          selectedCategoryIds={selectedIds}
          search={search}
        />

        <ExpenseSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          spaceId={spaceId}
          categories={categories.data ?? []}
          members={members.data ?? []}
          currency={space?.currency ?? 'EUR'}
        />
      </main>
    </AppShell>
  )
}
