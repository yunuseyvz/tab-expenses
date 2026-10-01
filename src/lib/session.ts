/**
 * Query options for the space-scoped data layer.
 *
 * Filter state lives in the query key, so switching a category chip or a date
 * range is a cache lookup rather than a refetch-then-filter. Every mutation
 * invalidates these keys, which is why the "explicit invalidation" model is
 * easier to reason about than a framework cache with implicit tags.
 */
import { queryOptions } from '@tanstack/react-query'

import {
  getBalances,
  getTotals,
  listExpenses,
} from './expense.functions'
import {
  listCategories,
  listMembers,
} from './space.functions'
import type { Period } from './period'

export const spaceKeys = {
  all: ['spaces'] as const,
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

export function membersQuery(spaceId: string) {
  return queryOptions({
    queryKey: spaceKeys.members(spaceId),
    queryFn: () => listMembers({ data: { spaceId } }),
  })
}

export function categoriesQuery(spaceId: string, includePersonal = true) {
  return queryOptions({
    queryKey: [...spaceKeys.categories(spaceId), includePersonal],
    queryFn: () => listCategories({ data: { spaceId, includePersonal } }),
  })
}

export function expensesQuery(spaceId: string, filter: ListFilter) {
  return queryOptions({
    queryKey: spaceKeys.expenses(spaceId, filter),
    queryFn: () =>
      listExpenses({
        data: {
          spaceId,
          from: filter.from,
          to: filter.to,
          categoryIds: filter.categoryIds,
          memberId: filter.memberId,
        },
      }),
  })
}

export function totalsQuery(spaceId: string, filter: ListFilter) {
  return queryOptions({
    queryKey: spaceKeys.totals(spaceId, filter),
    queryFn: () =>
      getTotals({
        data: {
          spaceId,
          from: filter.from,
          to: filter.to,
          categoryIds: filter.categoryIds,
        },
      }),
  })
}

export function balancesQuery(spaceId: string, filter: Period) {
  return queryOptions({
    queryKey: spaceKeys.balances(spaceId, filter),
    queryFn: () =>
      getBalances({
        data: { spaceId, from: filter.from, to: filter.to },
      }),
  })
}
