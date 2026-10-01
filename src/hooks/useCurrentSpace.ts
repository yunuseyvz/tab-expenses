import { useQuery } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'

import { resolveSpaceId } from '#/lib/space-preference'
import { rememberedSpaceQuery, spaceKeys } from '#/lib/session'
import { listMySpaces } from '#/lib/auth.functions'

/**
 * Resolve which space the UI is currently showing.
 *
 * Preference order lives in resolveSpaceId — `?space=`, then the last space this
 * browser used, then the first one. Every screen needs this, and getting it in
 * one hook means the spaceId is never undefined-but-truthy by accident.
 *
 * Both inputs come from the query cache, which the protected layout has already
 * filled during SSR. Reading the cookie in an effect instead would settle on
 * the right space but leave the first client render showing the wrong
 * household's name and totals.
 */
export function useCurrentSpace(requestedSpaceId?: string) {
  const spaces = useQuery({
    queryKey: spaceKeys.mySpaces,
    queryFn: () => listMySpaces(),
  })
  const remembered = useQuery(rememberedSpaceQuery())

  // The URL's own `?space=`, read here rather than by each caller.
  //
  // The sidebar trigger used to call this with no argument, which sent it down
  // the cookie branch alone while every route passed `search.space` and went
  // down the URL branch. The two answers disagreed whenever the URL named a
  // space the cookie did not — a bookmark, a shared link, a link inside the app
  // — and the page would show one household while the switcher showed another,
  // with the check mark on the wrong row. Reading the URL here means the cookie
  // is only ever the fallback, which is the order the rest of the app assumes.
  const urlSpaceId = useRouterState({
    select: (s) => {
      const value = (s.location.search as Record<string, unknown>).space
      return typeof value === 'string' ? value : undefined
    },
  })

  const list = spaces.data ?? []
  const spaceId = resolveSpaceId(
    list,
    requestedSpaceId ?? urlSpaceId,
    remembered.data ?? null,
  )

  return {
    spaces: list,
    space: list.find((s) => s.id === spaceId) ?? null,
    spaceId,
    isLoading: spaces.isPending,
  }
}
