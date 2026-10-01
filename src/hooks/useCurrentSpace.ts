import { useQuery } from '@tanstack/react-query'

import { listMySpaces } from '#/lib/auth.functions'

/**
 * Resolve which space the UI is currently showing.
 *
 * Preference order: an explicit `?space=` in the URL, then the user's first
 * space. Every screen needs this, and getting it in one hook means the
 * spaceId is never undefined-but-truthy by accident.
 */
export function useCurrentSpace(requestedSpaceId?: string) {
  const spaces = useQuery({
    queryKey: ['my-spaces'],
    queryFn: () => listMySpaces(),
  })

  const list = spaces.data ?? []
  const space = requestedSpaceId
    ? list.find((s) => s.id === requestedSpaceId)
    : list[0]

  return {
    spaces: list,
    space: space ?? null,
    spaceId: space?.id ?? null,
    isLoading: spaces.isPending,
  }
}
