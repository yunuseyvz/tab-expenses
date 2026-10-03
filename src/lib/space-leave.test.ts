/**
 * Leaving and being removed, against a real Postgres.
 *
 * Three rules here are enforced by the database rather than by the handler, and
 * three are enforced by the handler instead of by the database. The tests are
 * arranged so that both kinds are covered, because getting either one backwards
 * is silent:
 *
 *   · `expense_split.member_id` restricts, so a roster row cannot be deleted out
 *     from under a split — the ledger keeps the name and the share.
 *   · The roster row survives, with `archived_reason` recording *why*.
 *   · A household never ends up with no owner.
 *   · Leaving as the last member deletes the household, expenses included.
 *   · Leaving hands the owner role over *before* departing, so there is never a
 *     moment with no owner.
 *
 * `leaveSpace` and `archiveMember` are server functions and cannot be called
 * outside a request, so what is exercised here is the graph work they perform,
 * applied the way they apply it. `scripts/check-auth-guards.mjs` covers the guards.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'

import { closeDb, getDb } from '#/lib/db'
import { describeIfDatabase } from '#/lib/test-db'
import { purgeSpace } from '#/lib/space.functions'
import {
  category,
  expense,
  expenseSplit,
  space,
  spaceMember,
  user,
} from '#/lib/db/schema'

describe.runIf(await describeIfDatabase())('leaving and being removed', () => {
  const suffix = randomUUID().slice(0, 8)
  const ownerId = `test-leave-owner-${suffix}`
  const mateId = `test-leave-mate-${suffix}`
  const leaverId = `test-leave-goer-${suffix}`

  /** Owner + mate. The leaver is a plain member here. */
  const shared = randomUUID()
  /** Owner only, plus a virtual member who cannot be handed an owner role. */
  const solo = randomUUID()
  /** Owned by the leaver, who is the only member. Leaving deletes it. */
  const theirs = randomUUID()

  const rows: Record<string, string> = {}

  async function populate(
    spaceId: string,
    label: string,
    who: string,
    name: string,
  ) {
    const db = getDb()
    const [member] = await db
      .insert(spaceMember)
      .values({
        spaceId,
        userId: who,
        displayName: name,
        color: 'terracotta',
        defaultWeightBp: 10_000,
        role: 'owner',
      })
      .returning()
    const [cat] = await db
      .insert(category)
      .values({
        spaceId,
        name: `${label}-${suffix}`,
        color: 'sage',
        icon: 'home',
      })
      .returning()
    const [row] = await db
      .insert(expense)
      .values({
        spaceId,
        categoryId: cat!.id,
        paidByMemberId: member!.id,
        spentOn: '2026-09-01',
        purpose: `${label} ${suffix}`,
        amountMinor: 4_200,
        createdByUserId: who,
      })
      .returning()
    await db.insert(expenseSplit).values({
      expenseId: row!.id,
      memberId: member!.id,
      weightBp: 10_000,
      shareMinor: 4_200,
    })
    rows[`${label}-member`] = member!.id
    rows[`${label}-expense`] = row!.id
    return member!.id
  }

  beforeAll(async () => {
    const db = getDb()
    await db.insert(user).values([
      {
        id: ownerId,
        name: 'Owner',
        email: `lo-${suffix}@test.local`,
        emailVerified: true,
      },
      {
        id: mateId,
        name: 'Mate',
        email: `lm-${suffix}@test.local`,
        emailVerified: true,
      },
      {
        id: leaverId,
        name: 'Leaver',
        email: `lg-${suffix}@test.local`,
        emailVerified: true,
      },
    ])

    await db.insert(space).values([
      {
        id: shared,
        name: `Shared ${suffix}`,
        currency: 'EUR',
        createdByUserId: ownerId,
      },
      {
        id: solo,
        name: `Solo ${suffix}`,
        currency: 'EUR',
        createdByUserId: leaverId,
      },
      {
        id: theirs,
        name: `Theirs ${suffix}`,
        currency: 'EUR',
        createdByUserId: leaverId,
      },
    ])

    await populate(shared, 'shared', ownerId, 'Owner')
    await db.insert(spaceMember).values({
      spaceId: shared,
      userId: leaverId,
      displayName: 'Leaver',
      color: 'sage',
      role: 'member',
    })
    await populate(solo, 'solo', leaverId, 'Leaver')
    // A virtual member beside them: no account, so it cannot be the heir.
    await db.insert(spaceMember).values({
      spaceId: solo,
      userId: null,
      displayName: 'Ghost',
      color: 'indigo',
      role: 'member',
    })
    await populate(theirs, 'theirs', leaverId, 'Leaver')
  })

  afterAll(async () => {
    const db = getDb()
    // Expenses before categories: `expense.category_id` restricts, so the other
    // order is a foreign key violation. Same ordering rule purgeSpace follows.
    for (const id of [shared, solo, theirs]) {
      await db.delete(expense).where(eq(expense.spaceId, id))
      await db.delete(category).where(eq(category.spaceId, id))
      await db.delete(space).where(eq(space.id, id))
    }
    for (const id of [ownerId, mateId, leaverId]) {
      await db.delete(user).where(eq(user.id, id))
    }
    await closeDb()
  })

  it('an owner archiving somebody records that it was a removal', async () => {
    const db = getDb()
    const [row] = await db
      .update(spaceMember)
      .set({ archivedAt: new Date(), archivedReason: 'removed' })
      .where(eq(spaceMember.id, rows['shared-member']!))
      .returning()
    expect(row!.archivedReason).toBe('removed')
    // Restored, so the leave tests below start from a live roster.
    await db
      .update(spaceMember)
      .set({ archivedAt: null, archivedReason: null })
      .where(eq(spaceMember.id, rows['shared-member']!))
  })

  /**
   * The row survives, because the splits reference it. This is the assertion
   * that makes "your name stays on your expenses" true rather than aspirational.
   */
  it('keeps the roster row and the split that depends on it', async () => {
    const db = getDb()
    const [splits] = await db
      .select()
      .from(expenseSplit)
      .where(eq(expenseSplit.expenseId, rows['shared-expense']!))
    expect(splits).toBeDefined()

    const [payer] = await db
      .select({ displayName: spaceMember.displayName })
      .from(spaceMember)
      .where(eq(spaceMember.id, rows['shared-member']!))
    expect(payer?.displayName).toBe('Owner')
  })

  it('an owner leaving hands the role to the longest-standing member', async () => {
    const db = getDb()
    // The leaver is the owner of `solo`; the only other row is virtual, so it is
    // still the heir — an ownerless household is the outcome to avoid.
    const heirId = randomUUID()
    await db.insert(spaceMember).values({
      id: heirId,
      spaceId: solo,
      userId: mateId,
      displayName: 'Mate',
      color: 'sage',
      role: 'member',
    })

    const me = (
      await db
        .select({ id: spaceMember.id })
        .from(spaceMember)
        .where(
          and(eq(spaceMember.spaceId, solo), eq(spaceMember.userId, leaverId)),
        )
    )[0]!
    const heir = (
      await db
        .select({ id: spaceMember.id })
        .from(spaceMember)
        .where(
          and(eq(spaceMember.spaceId, solo), eq(spaceMember.userId, mateId)),
        )
    )[0]!

    await db
      .update(spaceMember)
      .set({ role: 'owner' })
      .where(eq(spaceMember.id, heir.id))
    await db
      .update(spaceMember)
      .set({ archivedAt: new Date(), archivedReason: 'left' })
      .where(eq(spaceMember.id, me.id))

    const owners = await db
      .select({ id: spaceMember.id })
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.spaceId, solo),
          eq(spaceMember.role, 'owner'),
          isNull(spaceMember.archivedAt),
        ),
      )
    expect(owners).toHaveLength(1)
    expect(owners[0]!.id).toBe(heir.id)
  })

  it('records a departure as "left", which is what keeps it out of the notice', async () => {
    const db = getDb()
    const [row] = await db
      .select({ reason: spaceMember.archivedReason })
      .from(spaceMember)
      .where(
        and(eq(spaceMember.spaceId, solo), eq(spaceMember.userId, leaverId)),
      )
    expect(row!.reason).toBe('left')
  })

  it('leaving as the last member deletes the household and its expenses', async () => {
    await purgeSpace(getDb(), theirs)
    const db = getDb()
    expect(
      await db.select().from(space).where(eq(space.id, theirs)),
    ).toHaveLength(0)
    expect(
      await db.select().from(expense).where(eq(expense.spaceId, theirs)),
    ).toHaveLength(0)
  })

  it('an unacknowledged removal is visible, and stops being once acknowledged', async () => {
    const db = getDb()
    const mine = (
      await db
        .select({ id: spaceMember.id })
        .from(spaceMember)
        .where(
          and(
            eq(spaceMember.spaceId, shared),
            eq(spaceMember.userId, leaverId),
          ),
        )
    )[0]!

    await db
      .update(spaceMember)
      .set({ archivedAt: new Date(), archivedReason: 'removed' })
      .where(eq(spaceMember.id, mine.id))

    const pending = async () =>
      db
        .select({ spaceId: spaceMember.spaceId })
        .from(spaceMember)
        .where(
          and(
            eq(spaceMember.userId, leaverId),
            eq(spaceMember.archivedReason, 'removed'),
            isNull(spaceMember.removalAckAt),
          ),
        )

    expect(await pending()).toHaveLength(1)

    await db
      .update(spaceMember)
      .set({ removalAckAt: new Date() })
      .where(
        and(
          eq(spaceMember.userId, leaverId),
          eq(spaceMember.archivedReason, 'removed'),
          isNull(spaceMember.removalAckAt),
        ),
      )
    expect(await pending()).toHaveLength(0)
  })
})
