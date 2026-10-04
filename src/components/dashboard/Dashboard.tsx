import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Lock, StickyNote } from 'lucide-react'

import type { Category } from '#/lib/db/schema'
import type { PeriodPreset } from '#/lib/period'
import type { ExpenseRow } from '#/lib/expense.functions'
import type { ListFilter } from '#/lib/session'
import { CountUp } from '#/components/CountUp'
import { MemberAvatar } from '#/components/MemberAvatar'
import {
  Card,
  CardHeader,
  CardTitle,
  Row,
  SectionTitle,
} from '#/components/ui/Card'
import { CategoryChips } from '#/components/dashboard/CategoryChips'
import { CategoryBars } from '#/components/dashboard/CategoryBars'
import { balancesQuery, expensesQuery, totalsQuery } from '#/lib/session'
import { formatMoney } from '#/lib/money'
import { swatchColor } from '#/lib/swatches'
import { useMayEditExpense } from '#/hooks/useMayEditExpense'
import { UNCATEGORISED_CHIP } from '#/lib/uncategorised'

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
  onEdit,
}: {
  /** Opens the editor for a row. Null on screens that cannot edit. */
  onEdit?: (row: ExpenseRow) => void
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
  const mayEdit = useMayEditExpense()

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
          {/* The paragraph is the caller's, not CountUp's: a figure is a
              paragraph, and the element that carries the type should be the one
              a test and a screen reader meet. */}
          {/* The sans, not the wordmark's serif. Fraunces is loaded at optical
              size 144, which is a *display* face — very high stroke contrast,
              almost calligraphic. That is the right register for three letters
              and the wrong one for a total: at €16,569.23 the comma and the
              6, 9 and 5 stop reading as digits and start reading as lettering.
              `tnum` keeps the columns aligned, which is what the serif was
              actually doing there. */}
          <p className="tnum text-3xl mt-1">
            {totals.isPending ? (
              '—'
            ) : (
              <CountUp
                value={totals.data?.totalMinor ?? 0}
                format={(v: number) => formatMoney(v, currency)}
              />
            )}
          </p>
          <p className="text-xs text-ink-faint mt-1 tnum">
            {totals.data?.count ?? 0} entries
          </p>
        </Card>

        <Card>
          <SectionTitle>Your share</SectionTitle>
          {/* The sans, not the wordmark's serif. Fraunces is loaded at optical
              size 144, which is a *display* face — very high stroke contrast,
              almost calligraphic. That is the right register for three letters
              and the wrong one for a total: at €16,569.23 the comma and the
              6, 9 and 5 stop reading as digits and start reading as lettering.
              `tnum` keeps the columns aligned, which is what the serif was
              actually doing there. */}
          <p className="tnum text-3xl mt-1">
            {totals.isPending ? (
              '—'
            ) : (
              <CountUp
                value={totals.data?.yourShareMinor ?? 0}
                format={(v: number) => formatMoney(v, currency)}
              />
            )}
          </p>
          <p
            className="text-xs mt-1 tnum font-medium"
            style={{
              color:
                yourNet >= 0 ? 'var(--color-sage)' : 'var(--color-oxblood)',
            }}
          >
            {yourNet >= 0 ? 'you are owed ' : 'you owe '}
            {formatMoney(Math.abs(yourNet), currency)}
          </p>
        </Card>
      </div>

      <CategoryChips
        categories={[...categories, UNCATEGORISED_CHIP]}
        allIds={allCategoryIds}
        selected={selectedCategoryIds}
        onChange={setCategories}
      />

      <Card>
        <CardHeader>
          <CardTitle>By category</CardTitle>
        </CardHeader>
        <CategoryBars
          data={totals.data?.byCategory ?? []}
          currency={currency}
          totalMinor={totals.data?.totalMinor ?? 0}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent entries</CardTitle>
        </CardHeader>
        {recentRows.length === 0 ? (
          <p className="text-sm text-ink-faint py-2">Nothing here yet.</p>
        ) : (
          <div>
            {recentRows.map((e, i) => {
              const edit = mayEdit(e)
              return (
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
                  <button
                    type="button"
                    onClick={() => onEdit?.(e)}
                    aria-label={
                      edit.canEdit
                        ? `Edit ${e.purpose}, ${formatMoney(e.amountMinor, currency)}`
                        : `View ${e.purpose}, ${formatMoney(e.amountMinor, currency)}. ${edit.reason}`
                    }
                    className="w-full text-left transition-colors duration-150"
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
                      <span className="min-w-0 flex-1">
                        <span className="truncate text-sm font-medium block">
                          {e.purpose}
                        </span>
                        <span className="flex items-center gap-1.5 min-w-0 mt-0.5">
                          <MemberAvatar
                            memberId={e.paidByMemberId}
                            avatar={e.paidByAvatar}
                            name={e.paidByName}
                            size={15}
                          />
                          <span className="truncate text-xs text-ink-faint">
                            {e.paidByName}
                          </span>
                          <span className="truncate text-xs text-ink-faint/70 tnum">
                            {e.categoryName ?? 'Uncategorised'} · {e.spentOn}
                          </span>
                        </span>
                      </span>
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
                    </Row>
                  </button>
                </motion.div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
