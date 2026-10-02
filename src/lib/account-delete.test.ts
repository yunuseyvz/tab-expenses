/**
 * Deleting an account, against a real Postgres.
 *
 * Account deletion is the one operation whose failure is invisible until it is
 * too late: the account is gone, and so is whatever else went with it. So this
 * is a real test rather than a click-through, and the shape of it mirrors
 * space-delete.test.ts for the same reason — the cascade and the `restrict`
 * rules are only honestly exercised against the database that enforces them.
 *
 * What is asserted, and why each one is not obvious:
 *
 *   1. A shared household survives intact. Its expenses, splits and categories
 *      must still be there afterwards, still naming the person who left. A
 *      delete that quietly removed them would leave the remaining members with a
 *      ledger that silently rewrites itself every time anyone leaves.
 *
 *   2. Its owner is handed over. A household with no owner cannot be managed,
 *      which is why archiveMember refuses to archive the last one. Deleting an
 *      account has to satisfy that rule rather than trip over it, and the only
 *      way to know it did is to look for a new owner afterwards.
 *
 *   3. A household where this person was the last member goes, expenses and all.
 *      It was already unreachable — every roster row was theirs — so keeping it
 *      would strand a ledger nobody can ever open.
 *
 *   4. An unrelated household belonging to somebody else is untouched.
 *
 * Runs against DATABASE_URL and skips (rather than fails) when no database is
 * reachable, so `pnpm test` still works on a bare checkout.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { closeDb, getDb } from '#/lib/db'
import { describeIfDatabase } from '#/lib/test-db'
import { purgeAccount } from '#/lib/account.functions'
import {
  category,
  expense,
  expenseSplit,
  session,
  space,
  spaceInvite,
  spaceMember,
  user,
} from '#/lib/db/schema'

describe.runIf(await describeIfDatabase())('deleting an account', () => {
  const suffix = randomUUID().slice(0, 8)
  const leaverId = `test-acc-leaver-${suffix}`
  const heirId = `test-acc-heir-${suffix}`
  const strangerId = `test-acc-stranger-${suffix}`
  /** An owner who has already deleted their account. */
  const departedId = `test-acc-departed-${suffix}`

  /** Household they share, one they created alone, one they are only on. */
  const shared = randomUUID()
  const solo = randomUUID()
  /**
   * Owned by somebody else, and the leaver is its only registered member. The
   * owner has already gone, so this is the case where "nobody is left to run it"
   * is true *and* deleting it would be destroying another household's ledger.
   */
  const borrowed = randomUUID()
  /** Somebody else's household, which must not move. */
  const stranger = randomUUID()

  const ids: Record<string, string> = {}

  /** A space with a member, a category, an invite, an expense and a split. */
  async function populate(
    spaceId: string,
    label: string,
    ownerUserId: string,
    memberName: string,
  ) {
    const db = getDb()
    const [member] = await db
      .insert(spaceMember)
      .values({
        spaceId,
        userId: ownerUserId,
        displayName: memberName,
        color: 'terracotta',
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
    await db.insert(spaceInvite).values({
      spaceId,
      email: `${label}-${suffix}@test.local`,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    const [row] = await db
      .insert(expense)
      .values({
        spaceId,
        categoryId: cat!.id,
        paidByMemberId: member!.id,
        purpose: `${label} ${suffix}`,
        amountMinor: 4_200,
        spentOn: '2026-09-01',
        createdByUserId: ownerUserId,
      })
      .returning()
    await db.insert(expenseSplit).values({
      expenseId: row!.id,
      memberId: member!.id,
      weightBp: 10_000,
      shareMinor: 4_200,
    })
    ids[`${label}-member`] = member!.id
    ids[`${label}-expense`] = row!.id
  }

  beforeAll(async () => {
    const db = getDb()
    await db.insert(user).values([
      {
        id: leaverId,
        name: 'Leaver',
        email: `acc-leaver-${suffix}@test.local`,
        emailVerified: true,
      },
      {
        id: heirId,
        name: 'Heir',
        email: `acc-heir-${suffix}@test.local`,
        emailVerified: true,
      },
      {
        id: strangerId,
        name: 'Stranger',
        email: `acc-stranger-${suffix}@test.local`,
        emailVerified: true,
      },
      {
        id: departedId,
        name: 'Departed',
        email: `acc-departed-${suffix}@test.local`,
        emailVerified: true,
      },
    ])
    // A session row, so the cascade to Better Auth's own tables is exercised.
    await db.insert(session).values({
      id: `test-acc-session-${suffix}`,
      token: `test-acc-token-${suffix}`,
      userId: leaverId,
      expiresAt: new Date(Date.now() + 86_400_000),
    })

    await db.insert(space).values([
      {
        id: shared,
        name: `Shared ${suffix}`,
        currency: 'EUR',
        createdByUserId: leaverId,
      },
      {
        id: solo,
        name: `Solo ${suffix}`,
        currency: 'EUR',
        createdByUserId: leaverId,
      },
      {
        id: stranger,
        name: `Stranger ${suffix}`,
        currency: 'EUR',
        createdByUserId: strangerId,
      },
      {
        id: borrowed,
        name: `Borrowed ${suffix}`,
        currency: 'EUR',
        createdByUserId: departedId,
      },
    ])

    // They share one, and they are the only *registered* person on the other.
    // `shared` also gets a virtual member: a household with only a virtual
    // member besides you has nobody to hand over to, so it must still be
    // treated as the leaver's alone.
    await populate(shared, 'shared', leaverId, 'Leaver')
    await db.insert(spaceMember).values({
      spaceId: shared,
      userId: heirId,
      displayName: 'Heir',
      color: 'indigo',
      role: 'member',
    })
    await populate(solo, 'solo', leaverId, 'Leaver')
    await populate(stranger, 'stranger', strangerId, 'Stranger')

    // A household the leaver is *on* but does not own. Its owner is `departed`,
    // who is registered but will not be a member of it — see the archived row
    // below — so nobody else is on it while the leaver is.
    await populate(borrowed, 'borrowed', leaverId, 'Leaver')
    await db
      .update(spaceMember)
      .set({ role: 'member' })
      .where(eq(spaceMember.spaceId, borrowed))
    await db.insert(spaceMember).values({
      spaceId: borrowed,
      userId: departedId,
      displayName: 'Departed',
      color: 'plum',
      role: 'owner',
      archivedAt: new Date(),
    })
  })

  afterAll(async () => {
    const db = getDb()
    for (const id of [shared, solo, stranger, borrowed]) {
      await db.delete(spaceInvite).where(eq(spaceInvite.spaceId, id))
      await db.delete(expense).where(eq(expense.spaceId, id))
      await db.delete(space).where(eq(space.id, id))
    }
    for (const id of [heirId, strangerId, departedId]) {
      await db.delete(user).where(eq(user.id, id))
    }
    await closeDb()
  })

  it('keeps a shared household, its expenses and its history', async () => {
    await purgeAccount(getDb(), leaverId)

    const db = getDb()
    const [kept] = await db.select().from(space).where(eq(space.id, shared))
    expect(kept).toBeDefined()

    const expenses = await db
      .select()
      .from(expense)
      .where(eq(expense.spaceId, shared))
    expect(expenses).toHaveLength(1)
    expect(expenses[0]!.id).toBe(ids['shared-expense'])

    const splits = await db
      .select()
      .from(expenseSplit)
      .where(eq(expenseSplit.expenseId, ids['shared-expense']!))
    expect(splits).toHaveLength(1)
    // The expense must keep its name even though the account is gone.
    const [payer] = await db
      .select({ displayName: spaceMember.displayName })
      .from(spaceMember)
      .where(eq(spaceMember.id, ids['shared-member']!))
    expect(payer?.displayName).toBe('Leaver')
  })

  it('archives the roster row instead of deleting it', async () => {
    const db = getDb()
    const [row] = await db
      .select()
      .from(spaceMember)
      .where(eq(spaceMember.id, ids['shared-member']!))
    expect(row).toBeDefined()
    expect(row!.archivedAt).not.toBeNull()
    // user_id went to NULL, which is what turns the row into a virtual member
    // and is why the split above still resolves.
    expect(row!.userId).toBeNull()
  })

  it('hands the shared household to the longest-standing member', async () => {
    const db = getDb()
    const members = await db
      .select()
      .from(spaceMember)
      .where(eq(spaceMember.spaceId, shared))
    const heir = members.find((m) => m.userId === heirId)
    expect(heir).toBeDefined()
    expect(heir!.role).toBe('owner')
    expect(heir!.archivedAt).toBeNull()
  })

  it('deletes a household where they were the last member', async () => {
    const db = getDb()
    const gone = await db.select().from(space).where(eq(space.id, solo))
    expect(gone).toHaveLength(0)
    const expenses = await db
      .select()
      .from(expense)
      .where(eq(expense.spaceId, solo))
    expect(expenses).toHaveLength(0)
  })

  /**
   * The disagreement this pins. `solo` is the leaver's own household and they own
   * it, so it goes. `borrowed` is one they are only a member of and do not own,
   * so it survives — the ledger belongs to whoever owns it, and "the last person
   * with an account happened to be on it" is not a reason to destroy it.
   *
   * Before the fix the preview counted `borrowed` as going to be deleted while
   * the purge left it alone, so the dialog stated a consequence the code did not
   * implement.
   */
  it('keeps a household they are only a member of, even as the last one', async () => {
    const db = getDb()
    const kept = await db.select().from(space).where(eq(space.id, borrowed))
    expect(kept).toHaveLength(1)
    const expenses = await db
      .select()
      .from(expense)
      .where(eq(expense.spaceId, borrowed))
    expect(expenses).toHaveLength(1)
  })

  it('deletes the account, its session, and only its own rows', async () => {
    const db = getDb()
    const gone = await db.select().from(user).where(eq(user.id, leaverId))
    expect(gone).toHaveLength(0)
    const sessions = await db
      .select()
      .from(session)
      .where(eq(session.userId, leaverId))
    expect(sessions).toHaveLength(0)
    // Somebody else's account is not collateral.
    const kept = await db.select().from(user).where(eq(user.id, strangerId))
    expect(kept).toHaveLength(1)
  })

  it('leaves an unrelated household untouched', async () => {
    const db = getDb()
    const kept = await db.select().from(space).where(eq(space.id, stranger))
    expect(kept).toHaveLength(1)
    const expenses = await db
      .select()
      .from(expense)
      .where(eq(expense.spaceId, stranger))
    expect(expenses).toHaveLength(1)
    const members = await db
      .select()
      .from(spaceMember)
      .where(eq(spaceMember.spaceId, stranger))
    expect(members).toHaveLength(1)
    expect(members[0]!.archivedAt).toBeNull()
  })

  it('refuses an account that does not exist rather than reporting success', async () => {
    await expect(purgeAccount(getDb(), `nobody-${suffix}`)).rejects.toThrow(
      'Not found',
    )
  })
})
