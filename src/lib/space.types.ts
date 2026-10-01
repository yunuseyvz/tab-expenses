/**
 * A space as the UI sees it: one row of the "spaces I belong to" list.
 *
 * Declared here rather than inferred from the server function's return type,
 * because the client also needs to *write* this shape into the cache (see
 * SetupForm) and the server function's type is not exported.
 */
export interface MySpace {
  id: string
  name: string
  currency: string
  role: 'owner' | 'member'
  /** The caller's own member row, needed to attribute expenses to them. */
  memberId: string
}
