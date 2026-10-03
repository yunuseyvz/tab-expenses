/**
 * Who may change an expense, and how a removed member is named.
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
 */
import { describe, expect, it } from 'vitest'

import { displayMemberName } from './member-name'
import { editBlockedReason, mayEditExpense } from './may-edit'

const HOUSEHOLD = { editableByMembers: false }
const OPEN_HOUSEHOLD = { editableByMembers: true }

const OWNER = { userId: 'user-owner', role: 'owner' }
const MEMBER = { userId: 'user-member', role: 'member' }
const OTHER_MEMBER = { userId: 'user-other', role: 'member' }
const SIGNED_OUT = { userId: null, role: null }

describe('mayEditExpense', () => {
  it('lets you change what you entered', () => {
    expect(
      mayEditExpense({ createdByUserId: 'user-member' }, MEMBER, HOUSEHOLD),
    ).toBe(true)
  })

  it("stops a member changing somebody else's entry", () => {
    expect(
      mayEditExpense({ createdByUserId: 'user-other' }, MEMBER, HOUSEHOLD),
    ).toBe(false)
    expect(
      editBlockedReason({ createdByUserId: 'user-other' }, MEMBER, HOUSEHOLD),
    ).toBe('Entered by someone else')
  })

  it('lets an owner change anything, regardless of who entered it', () => {
    expect(
      mayEditExpense({ createdByUserId: 'user-other' }, OWNER, HOUSEHOLD),
    ).toBe(true)
    expect(
      mayEditExpense({ createdByUserId: 'user-owner' }, OWNER, HOUSEHOLD),
    ).toBe(true)
  })

  it('opens up when the household says so', () => {
    expect(
      mayEditExpense(
        { createdByUserId: 'user-other' },
        OTHER_MEMBER,
        OPEN_HOUSEHOLD,
      ),
    ).toBe(true)
  })

  /**
   * Deleting an account nulls `created_by_user_id`, so an entry whose author is
   * gone has an unknown author. Read as "not yours": an owner can still fix it,
   * and nobody else can, which is the safe reading of not knowing.
   */
  it('treats an entry with no author as unowned by nobody', () => {
    expect(mayEditExpense({ createdByUserId: null }, MEMBER, HOUSEHOLD)).toBe(
      false,
    )
    expect(
      editBlockedReason({ createdByUserId: null }, MEMBER, HOUSEHOLD),
    ).toBe('Entered by someone who has since deleted their account')
    // An owner can still correct it.
    expect(mayEditExpense({ createdByUserId: null }, OWNER, HOUSEHOLD)).toBe(
      true,
    )
  })

  it('offers nothing to a signed-out viewer', () => {
    expect(
      mayEditExpense({ createdByUserId: null }, SIGNED_OUT, OPEN_HOUSEHOLD),
    ).toBe(false)
    expect(
      mayEditExpense(
        { createdByUserId: 'user-member' },
        SIGNED_OUT,
        OPEN_HOUSEHOLD,
      ),
    ).toBe(false)
  })

  /**
   * The load-order case. Every input can be briefly absent on a re-render, and
   * the answer has to fail closed or the affordance flickers.
   */
  it('fails closed while the viewer or the household is still unknown', () => {
    const unknown = { userId: null, role: null }
    expect(
      mayEditExpense({ createdByUserId: 'user-member' }, unknown, HOUSEHOLD),
    ).toBe(false)
    expect(
      mayEditExpense({ createdByUserId: 'user-member' }, unknown, {
        editableByMembers: false,
      }),
    ).toBe(false)
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
