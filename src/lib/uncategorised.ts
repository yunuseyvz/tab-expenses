import type { Category } from './db/schema'

/**
 * The pseudo-id for entries without a category.
 *
 * Filter plumbing speaks ids — `cats=a,b` in the URL, `inArray()` in SQL — and
 * null cannot travel in either. So "no category" gets a stand-in id that can:
 * the chips toggle it, the URL carries it, and `categoryFilter` translates it
 * back to `category_id IS NULL` on the server. It is deliberately not a uuid,
 * so it can never collide with a real category, and the input schema accepts it
 * as a literal alongside uuids rather than loosening the whole array to
 * strings.
 */
export const UNCATEGORISED_ID = 'uncategorised'

/**
 * The badge for entries without a category, shaped like a Category because
 * that is what the chips render — the id is the giveaway, and the server
 * translates it back. Grey, because grey is not a swatch anyone can paint a
 * real category (see swatchColor, which passes raw CSS through for it).
 */
export const UNCATEGORISED_CHIP: Category = {
  id: UNCATEGORISED_ID,
  spaceId: '',
  name: 'Uncategorised',
  color: 'var(--color-rule)',
  icon: 'tag',
  scope: 'shared',
  ownerMemberId: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: new Date(0),
}
