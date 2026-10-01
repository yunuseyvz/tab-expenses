import { useQuery } from '@tanstack/react-query'

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

  const list = spaces.data ?? []
  const spaceId = resolveSpaceId(
    list,
    requestedSpaceId,
    remembered.data ?? null,
  )

  return {
    spaces: list,
    space: list.find((s) => s.id === spaceId) ?? null,
    spaceId,
    isLoading: spaces.isPending,
  }
}
