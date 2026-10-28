import { useMemo, useState } from 'react'

import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Lock, StickyNote } from 'lucide-react'
import type { ExpenseRow } from '#/lib/expense.functions'

import type { PeriodPreset } from '#/lib/period'
import type { ListFilter } from '#/lib/session'
import { AppShell } from '#/components/AppShell'
import { NewExpenseButton } from '#/components/NewExpenseButton'
import { Select } from '#/components/ui/Input'
import { Button } from '#/components/ui/Button'
import { Card } from '#/components/ui/Card'
import { MemberAvatar } from '#/components/MemberAvatar'
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
import { useMayEditExpense } from '#/hooks/useMayEditExpense'
import { resolveSpaceId } from '#/lib/space-preference'
import { PeriodFilter } from '#/components/PeriodFilter'
import { CategoryChips } from '#/components/dashboard/CategoryChips'
import { UNCATEGORISED_CHIP } from '#/lib/uncategorised'

export const Route = createFileRoute('/_protected/expenses')({
  validateSearch: (s: Record<string, unknown>) => ({
    space: typeof s.space === 'string' ? s.space : undefined,
    period: (typeof s.period === 'string' ? s.period : 'all') as PeriodPreset,
    member: typeof s.member === 'string' ? s.member : undefined,
    cats: typeof s.cats === 'string' ? s.cats : undefined,
    /*
     * 1-based, in the URL, so a page of the ledger is a thing you can send
     * somebody. See the note on `offset` in listExpenses for why this is not a
     * cursor.
     *
     * A NUMBER, and the string form is accepted only on the way in. The router
     * JSON-stringifies search values and parses them back with a fallback to raw
     * text when the parse throws — which is why `period=all` and a uuid come back
     * looking clean while a numeric string silently round-trips as `"2"`,
     * quotes and all. That is invisible in the address bar until you notice the
     * page does not survive a reload. Passing a number cannot be quoted, and the
     * string branch keeps any link written by hand working.
     */
    page:
      typeof s.page === 'number'
        ? s.page
        : typeof s.page === 'string'
          ? Math.max(1, Number.parseInt(s.page, 10) || 1)
          : 1,
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

    const filter: ListFilter = {
      ...period,
      memberId: deps.member ?? null,
      /*
       * Built the same way the component builds it, which is the whole point.
       *
       * This used to intersect the ids against `allIds`, the real category rows.
       * That silently dropped `UNCATEGORISED_ID` — a pseudo-id by design, so it
       * is never in `allIds` — while the component below passed it straight
       * through. The two therefore keyed their queries differently for that one
       * filter, so the server fetched the right page, threw it away, and the
       * client asked again. Filtering by Uncategorised cost two round trips and
       * flashed the wrong thing on the way.
       *
       * The server does not need the intersection: an id that is not a category
       * matches nothing, which is the right answer anyway.
       */
      categoryIds: deps.cats ? deps.cats.split(',') : undefined,
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

  const PAGE_SIZE = 50
  const page = Math.max(1, search.page)

  const expenses = useQuery({
    ...expensesQuery(spaceId ?? '', filter, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    enabled: Boolean(spaceId),
    // Debounce-ish: keep the previous page visible while the next loads, so
    // dragging a filter does not flash an empty screen every frame.
    placeholderData: keepPreviousData,
  })

  const rows = expenses.data?.rows ?? []
  const total = expenses.data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  /*
   * The chip list, built the same way the dashboard builds it: the real
   * categories plus the Uncategorised pseudo-id. That id is not a row in
   * `category`, which is why the loader above used to drop it, so it is added
   * here explicitly rather than being assumed to come with the query.
   */
  const chipCategories = useMemo(
    () => [...(categories.data ?? []), UNCATEGORISED_CHIP],
    [categories.data],
  )

  /*
   * The day header's figure comes from the server, not from the rows on screen.
   *
   * `groupByDay` sums the array it is given, which used to be the whole ledger and
   * is now one page — so a day split across a page boundary would have had its
   * total silently halved, and the day figures would no longer add up to the period
   * total printed above them. The two numbers are on the same screen and a reader
   * is entitled to expect them to agree.
   */
  const dayTotals = useMemo(
    () =>
      new Map(
        (expenses.data?.dayTotals ?? []).map((d) => [d.spentOn, d.totalMinor]),
      ),
    [expenses.data],
  )
  const groups = useMemo(
    () =>
      groupByDay(rows).map((g) => ({
        ...g,
        totalMinor: dayTotals.get(g.date) ?? g.totalMinor,
      })),
    [rows, dayTotals],
  )
  const currency = space?.currency ?? 'EUR'
  const mayEdit = useMayEditExpense()

  // One sheet for both jobs. `editing === null` means "new"; otherwise the row
  // that was tapped comes with it, already filled in.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<ExpenseRow | null>(null)

  const openNew = () => {
    setEditing(null)
    setSheetOpen(true)
  }
  /**
   * Always opens. An entry you cannot edit still opens — read-only, with the
   * reason stated inside — because a row that refuses to open reads as broken,
   * while a sheet that says whose entry this is reads as somebody else's.
   */
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
      page: number | undefined
      from: string | undefined
      to: string | undefined
    }>,
  ) => {
    void navigate({ to: '/expenses', search: { ...search, ...patch } })
  }

  /*
   * The sum on screen is the sum of THIS PAGE, and the header has to say so.
   *
   * Before paging there was no difference — everything loaded was everything, so
   * the header could state a figure that meant the whole filter. With a page of
   * fifty it cannot: the same sentence over a different page's rows would move,
   * and a number that changes when you turn the page reads as a bug rather than
   * as a page boundary.
   */
  const pageTotal = rows.reduce((s, e) => s + e.amountMinor, 0)
  const whole = lastPage <= 1

  return (
    <AppShell>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl tracking-tight">Expenses</h1>
            <p className="text-xs text-ink-faint tnum">
              {whole
                ? `${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'} · `
                : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()} · `}
              {formatMoney(pageTotal, currency)}
              {whole ? '' : ' on this page'}
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

        {/*
          The same chips the dashboard uses, on the screen the dashboard's chips
          lead to.

          `?cats=` has been in this route's search schema and has filtered the
          ledger correctly the whole time — there was simply no control that set
          it, so the one place a reader could see every entry in a category was
          reachable only by editing the URL by hand. The capability was finished
          and the door was missing.

          Sharing the component is the point rather than a convenience: a chip
          that means the same thing on two screens, and is pressed the same way,
          is one thing to learn rather than two that look alike.
        */}
        <div>
          <CategoryChips
            categories={chipCategories}
            allIds={chipCategories.map((c) => c.id)}
            selected={search.cats ? search.cats.split(',') : undefined}
            onChange={(next) => go({ cats: next?.join(',') })}
          />
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
                  {g.items.map((e) => {
                    const edit = mayEdit(e)
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => openEdit(e)}
                        aria-label={
                          edit.canEdit
                            ? `Edit ${e.purpose}, ${formatMoney(e.amountMinor, currency)}`
                            : `View ${e.purpose}, ${formatMoney(e.amountMinor, currency)}. ${edit.reason}`
                        }
                        className="w-full flex items-center gap-3 px-4 py-3 text-left
                        border-b border-rule last:border-b-0
                        transition-colors duration-150
                        enabled:hover:bg-[var(--color-paper-sunk)]"
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
                          <span className="flex items-center gap-1.5 min-w-0 mt-0.5">
                            {/* The payer's face, not their name alone. On a household
                                ledger "who is this" is asked far more often than "how
                                much", and a column of identical text asked the reader to
                                hold the roster in their head to answer it. */}
                            <MemberAvatar
                              memberId={e.paidByMemberId}
                              avatar={e.paidByAvatar}
                              name={e.paidByName}
                              size={15}
                            />
                            <span className="truncate text-xs text-ink-faint">
                              {e.paidByName}
                            </span>
                            <span className="truncate text-xs text-ink-faint/70">
                              {e.categoryName ?? 'Uncategorised'}
                              {e.splits.length > 1 &&
                                ` · split ${e.splits.length} ways`}
                            </span>
                          </span>
                        </span>
                        {/* Read-only and conversation markers, beside the amount
                            rather than under it: the row's job is to say at a
                            glance whether this opens editable, and whether there
                            is anything to read under it. */}
                        {!edit.canEdit && (
                          <Lock
                            size={13}
                            aria-hidden
                            className="shrink-0 text-ink-faint"
                          />
                        )}
                        {e.noteCount > 0 && (
                          <span className="flex items-center gap-1 shrink-0 text-ink-faint">
                            <StickyNote size={13} aria-hidden />
                            <span className="text-xs tnum">{e.noteCount}</span>
                          </span>
                        )}
                        <span className="tnum text-sm font-medium shrink-0">
                          {formatMoney(e.amountMinor, currency)}
                        </span>
                      </button>
                    )
                  })}
                </Card>
              </section>
            ))}
          </div>
        )}

        {/*
          Paging. Two buttons and the count, rather than a scroller that loads on
          approach: a ledger is something people go *back* through looking for
          something, and "find March" means paging to it, not discovering where
          the infinite scroll happened to stop.
        */}
        {!whole && (
          <nav
            aria-label="Ledger pages"
            className="mt-5 flex items-center justify-between gap-3"
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page <= 1 || expenses.isFetching}
              onClick={() => go({ page: page > 2 ? page - 1 : 1 })}
            >
              <ChevronLeft size={15} aria-hidden />
              Newer
            </Button>
            <span className="text-xs text-ink-faint tnum">
              Page {page} of {lastPage}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page >= lastPage || expenses.isFetching}
              onClick={() => go({ page: page + 1 })}
            >
              Older
              <ChevronRight size={15} aria-hidden />
            </Button>
          </nav>
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
