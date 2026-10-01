/**
 * Time-of-day greeting.
 *
 * Boundaries are the ones people actually use rather than an even split: the
 * four traditional English parts of the day are anchored at 5am, 12n, 5pm and
 * 10pm, so a person opening the app at 4:45am is still "Good evening" from
 * yesterday and one opening at 5:01am is "Good morning".
 *
 * The hour comes from the *viewer's* clock, not the server's, and never from a
 * stored timezone. A household ledger is read wherever the reader is, and a
 * "Good morning" computed in UTC would be wrong for almost every reader of a
 * European app. It is also why this returns a plain string from a function
 * rather than a value computed in a loader: a server-rendered greeting would be
 * stamped at build time and would be a day out by lunchtime.
 */
export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

export function partOfDay(hour: number): PartOfDay {
  if (hour < 5) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}

const OPENING: Record<PartOfDay, string> = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
  // Not "Good night" — this is someone opening an app, not going to bed, and
  // "Good night" reads as a farewell.
  night: 'Hello',
}

/**
 * The greeting, with the reader's first name if there is one.
 *
 * Falls back to the bare greeting when there is no name, rather than greeting
 * "there" or inventing one. A missing name is a registration that predates the
 * field, not an error to paper over.
 *
 * The first name is taken from the first whitespace-separated token, which is
 * what "Vater" and "Vale" want and what "Anna Maria Weiss" will not get right —
 * a full given name is the better answer when someone has written two words, and
 * there is no way to know which is which, so the first token is the only choice
 * that is never *wrong*, merely sometimes short.
 */
export function greeting(
  name?: string | null,
  hour: number = new Date().getHours(),
): string {
  const opening = OPENING[partOfDay(hour)]
  const first = name?.trim().split(/\s+/)[0]
  return first ? `${opening}, ${first}` : opening
}
