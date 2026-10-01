/**
 * Which space the UI is showing.
 *
 * One account can hold several spaces and belong to several more, so every
 * screen has to answer the same question. It used to be answered inline in four
 * separate loaders, each of which fell back to `spaces[0]` — fine for one
 * household, wrong the moment someone owned two, because there was no way to
 * say which one you meant.
 *
 * Order is deliberate:
 *   1. `?space=` in the URL — explicit, shareable, survives a reload
 *   2. the last space this browser actually used — the everyday case
 *   3. the first space, so a fresh account still renders
 *
 * Anything that is not one of *your* spaces is ignored rather than trusted. A
 * hand-edited `?space=` from another household must not select it, and must not
 * blank the screen either — it falls through to the remembered space.
 */

export interface SpaceOption {
  id: string
}

/**
 * @returns the space to show, or null when the user has none at all.
 */
export function resolveSpaceId<T extends SpaceOption>(
  spaces: Array<T>,
  requested: string | undefined,
  remembered: string | null,
): string | null {
  const mine = requested && spaces.some((s) => s.id === requested)
  if (mine) return requested

  if (remembered && spaces.some((s) => s.id === remembered)) return remembered

  return spaces[0]?.id ?? null
}
