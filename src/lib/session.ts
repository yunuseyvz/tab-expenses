/**
 * Query options for the space-scoped data layer.
 *
 * Filter state lives in the query key, so switching a category chip or a date
 * range is a cache lookup rather than a refetch-then-filter. Every mutation
 * invalidates these keys, which is why the "explicit invalidation" model is
 * easier to reason about than a framework cache with implicit tags.
 *
 * Each query exposes both an options factory (for `useQuery`) and a plain
 * fetcher (for route `loader` prefetch). The loader prefetch is what makes SSR
 * render complete markup: without it the component's `useQuery` starts empty on
 * the server, the tree suspends, and the first paint is a blank shell.
 */
import { queryOptions } from '@tanstack/react-query'

import { getRememberedSpaceId } from './auth.functions'
import { getBalances, getTotals, listExpenses } from './expense.functions'
import { listCategories, listMembers } from './space.functions'
import type { QueryClient } from '@tanstack/react-query'
import type { Period } from './period'

export const spaceKeys = {
  all: ['spaces'] as const,
  mySpaces: ['my-spaces'] as const,
  // Which space this browser last used. Global rather than per-space because it
  // is a preference about the account, not about any one household.
  rememberedSpace: ['remembered-space'] as const,
  members: (spaceId: string) => ['spaces', spaceId, 'members'] as const,
  categories: (spaceId: string) => ['spaces', spaceId, 'categories'] as const,
  expenses: (spaceId: string, filter: unknown) =>
    ['spaces', spaceId, 'expenses', filter] as const,
  totals: (spaceId: string, filter: unknown) =>
    ['spaces', spaceId, 'totals', filter] as const,
  balances: (spaceId: string, filter: unknown) =>
    ['spaces', spaceId, 'balances', filter] as const,
}

export interface ListFilter extends Period {
  categoryIds?: Array<string>
  memberId?: string | null
}

// ── fetchers ─────────────────────────────────────────────────────────────

export const fetchMembers = (spaceId: string) =>
  listMembers({ data: { spaceId } })

export const fetchCategories = (spaceId: string, includePersonal = true) =>
  listCategories({ data: { spaceId, includePersonal } })

export const fetchExpenses = (spaceId: string, filter: ListFilter) =>
  listExpenses({
    data: {
      spaceId,
      from: filter.from,
      to: filter.to,
      categoryIds: filter.categoryIds,
      memberId: filter.memberId,
    },
  })

export const fetchTotals = (spaceId: string, filter: ListFilter) =>
  getTotals({
    data: {
      spaceId,
      from: filter.from,
      to: filter.to,
      categoryIds: filter.categoryIds,
    },
  })

export const fetchBalances = (spaceId: string, filter: Period) =>
  getBalances({ data: { spaceId, from: filter.from, to: filter.to } })

// ── options ──────────────────────────────────────────────────────────────

export function membersQuery(spaceId: string) {
  return queryOptions({
    queryKey: spaceKeys.members(spaceId),
    queryFn: () => fetchMembers(spaceId),
  })
}

export function categoriesQuery(spaceId: string, includePersonal = true) {
  return queryOptions({
    queryKey: [...spaceKeys.categories(spaceId), includePersonal],
    queryFn: () => fetchCategories(spaceId, includePersonal),
  })
}

export function expensesQuery(spaceId: string, filter: ListFilter) {
  return queryOptions({
    queryKey: spaceKeys.expenses(spaceId, filter),
    queryFn: () => fetchExpenses(spaceId, filter),
  })
}

export function totalsQuery(spaceId: string, filter: ListFilter) {
  return queryOptions({
    queryKey: spaceKeys.totals(spaceId, filter),
    queryFn: () => fetchTotals(spaceId, filter),
  })
}

/**
 * The last space this browser opened.
 *
 * In the query cache rather than router context on purpose: a child route's
 * loader `context` only carries its ancestors' *beforeLoad* results, not their
 * loader returns, so a value stashed in the protected layout's loader would be
 * invisible to the four screens that need it. This is also already warm after
 * SSR, so no screen pays an extra round trip for it.
 */
export function rememberedSpaceQuery() {
  return queryOptions({
    queryKey: spaceKeys.rememberedSpace,
    queryFn: () => getRememberedSpaceId(),
  })
}

export function balancesQuery(spaceId: string, filter: Period) {
  return queryOptions({
    queryKey: spaceKeys.balances(spaceId, filter),
    queryFn: () => fetchBalances(spaceId, filter),
  })
}

// ── SSR prefetch helpers ─────────────────────────────────────────────────

/**
 * Warm the cache for a set of queries during a route loader. Uses
 * `ensureQueryData` (not `prefetchQuery`) so a failure surfaces as a loader
 * error rather than silently rendering an empty dashboard.
 */
export async function ensureAll(
  queryClient: QueryClient,
  entries: Array<{
    queryKey: ReadonlyArray<unknown>
    queryFn: () => Promise<unknown>
  }>,
) {
  await Promise.all(
    entries.map((e) =>
      queryClient.ensureQueryData({ queryKey: e.queryKey, queryFn: e.queryFn }),
    ),
  )
}
