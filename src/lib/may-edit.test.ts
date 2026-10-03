/**
 * Who may change an expense.
 *
 * Two pure rules, both of which the UI depends on to decide whether to offer an
 * edit at all — so a wrong answer here means either a button that leads to a
 * rejection, or a member quietly editing entries they should not be able to.
 *
 * `mayEditExpense` is a mirror of the server's `assertMayEdit`, and the point
 * of this file is that the two agree. The server is what actually decides; this
 * copy decides what to offer. They are written out separately on purpose, so the
 * server's version stays a guard rather than a shared helper, and the test is
 * what keeps them from drifting.
 *
 * One rule now, not three: *the author decides.* An unlocked entry is editable
 * by anyone in the household; a locked one is editable by its author and nobody
 * else — not even an owner. There is no household-wide switch any more, because
 * one answer for a whole ledger had to be the most cautious value anybody ever
 * needed, which made it useless for everything else.
 */
import { describe, expect, it } from 'vitest'

import { displayMemberName } from './member-name'
import {
  editBlockedReason,
  isExpenseAuthor,
  mayDeleteExpenseNote,
  mayEditExpense,
} from './may-edit'

const ME = { userId: 'user-member' }
const OTHER = { userId: 'user-other' }
const SIGNED_OUT = { userId: null }

describe('mayEditExpense', () => {
  it('lets you change what you entered, locked or not', () => {
    expect(
      mayEditExpense({ createdByUserId: 'user-member', locked: false }, ME),
    ).toBe(true)
    expect(
      mayEditExpense({ createdByUserId: 'user-member', locked: true }, ME),
    ).toBe(true)
  })

  it("lets anyone change somebody else's unlocked entry", () => {
    expect(
      mayEditExpense({ createdByUserId: 'user-other', locked: false }, ME),
    ).toBe(true)
  })

  it("stops anyone changing somebody else's locked entry", () => {
    expect(
      mayEditExpense({ createdByUserId: 'user-other', locked: true }, ME),
    ).toBe(false)
    expect(
      editBlockedReason(
        { createdByUserId: 'user-other', locked: true },
        ME,
        'Alex',
      ),
    ).toBe('Alex locked this, so only they can change it')
  })

  it('names the author when the reason needs one', () => {
    expect(
      editBlockedReason(
        { createdByUserId: 'user-other', locked: true },
        ME,
        'Alex',
      ),
    ).toContain('Alex')
    expect(
      editBlockedReason(
        { createdByUserId: 'user-other', locked: true },
        ME,
        null,
      ),
    ).toBe('The person who added this locked it')
  })

  /**
   * Deleting an account nulls `created_by_user_id`, so an entry whose author is
   * gone has an unknown author. Read as "not yours": a locked one stays locked
   * for everybody, which is the safe reading of not knowing — and the only one
   * that does not quietly hand authorship to whoever is left.
   */
  it('treats an entry with no author as editable only while unlocked', () => {
    expect(mayEditExpense({ createdByUserId: null, locked: false }, ME)).toBe(
      true,
    )
    expect(mayEditExpense({ createdByUserId: null, locked: true }, ME)).toBe(
      false,
    )
    expect(
      editBlockedReason({ createdByUserId: null, locked: true }, ME, 'Alex'),
    ).toBe('Alex entered this and has since deleted their account')
  })

  it('offers nothing to a signed-out viewer', () => {
    expect(
      mayEditExpense(
        { createdByUserId: 'user-member', locked: false },
        SIGNED_OUT,
      ),
    ).toBe(false)
    expect(
      mayEditExpense(
        { createdByUserId: 'user-other', locked: false },
        SIGNED_OUT,
      ),
    ).toBe(false)
  })

  it('fails closed while the viewer is still unknown', () => {
    expect(
      mayEditExpense(
        { createdByUserId: 'user-member', locked: false },
        {
          userId: null,
        },
      ),
    ).toBe(false)
  })
})

describe('isExpenseAuthor', () => {
  it('is true only for the author', () => {
    expect(isExpenseAuthor({ createdByUserId: 'user-member' }, ME)).toBe(true)
    expect(isExpenseAuthor({ createdByUserId: 'user-other' }, ME)).toBe(false)
    expect(isExpenseAuthor({ createdByUserId: null }, ME)).toBe(false)
    expect(
      isExpenseAuthor({ createdByUserId: 'user-member' }, SIGNED_OUT),
    ).toBe(false)
  })

  it('does not follow the lock', () => {
    // An author can always edit, so "can I edit" is true for them either way —
    // while "is this mine to lock" is a different fact that must not move with
    // the toggle.
    expect(isExpenseAuthor({ createdByUserId: 'user-other' }, OTHER)).toBe(true)
  })
})

describe('mayDeleteExpenseNote', () => {
  const mine = { authorUserId: 'user-member' }
  const theirs = { authorUserId: 'user-other' }
  const orphaned = { authorUserId: null }
  const myEntry = { createdByUserId: 'user-member' }
  const theirEntry = { createdByUserId: 'user-other' }

  it('lets you take back your own remark', () => {
    expect(mayDeleteExpenseNote(mine, theirEntry, 'user-member')).toBe(true)
  })

  it('lets the entry author moderate notes under it', () => {
    expect(mayDeleteExpenseNote(theirs, myEntry, 'user-member')).toBe(true)
  })

  it('stops anyone else touching it', () => {
    expect(mayDeleteExpenseNote(theirs, theirEntry, 'user-member')).toBe(false)
  })

  it('offers nothing to a signed-out viewer', () => {
    expect(mayDeleteExpenseNote(mine, myEntry, null)).toBe(false)
  })

  /**
   * A note whose author deleted their account can only be cleared by the entry
   * author — the first rule can never fire, and that is the only way these
   * ever get cleared.
   */
  it('clears an orphaned note only via the entry author', () => {
    expect(mayDeleteExpenseNote(orphaned, myEntry, 'user-member')).toBe(true)
    expect(mayDeleteExpenseNote(orphaned, theirEntry, 'user-member')).toBe(
      false,
    )
  })
})

describe('displayMemberName', () => {
  it('leaves an active member alone', () => {
    expect(displayMemberName('Noor', null)).toBe('Noor')
    expect(displayMemberName('Noor', undefined)).toBe('Noor')
  })

  it('marks one who has left, keeping the name', () => {
    // The name is not replaced: the ledger records what happened, and the splits
    // that referenced this row still carry it. Only the new fact is added.
    expect(displayMemberName('Noor', new Date())).toBe('Noor (removed)')
    expect(displayMemberName('Noor', '2026-01-01')).toBe('Noor (removed)')
  })

  it('does not stack the suffix if called twice', () => {
    // A double application would read "Noor (removed) (removed)" on a row that
    // some future refactor passes through the formatter twice.
    const once = displayMemberName('Noor', new Date())
    expect(displayMemberName(once, null)).toBe(once)
  })
})
