/**
 * Deleting a space, against a real Postgres.
 *
 * This is the only irreversible operation in the app, so it gets a real test
 * rather than a click-through. Two things are being asserted, and only the
 * first one is obvious:
 *
 *   1. The cascade reaches all five tables. A `restrict` foreign key is correct
 *      for archiving and is exactly the kind of thing that turns a delete into
 *      a foreign key violation, so the assertion is on the rows being gone, not
 *      on the call returning.
 *
 *   2. It reaches *only* that space. A delete bug that also emptied a second
 *      household would pass every other test in this file, so the other
 *      household is populated identically and then checked row by row.
 *
 * What this does NOT pin: the statement order inside purgeSpace. A bare
 * `delete from space` also passes today — Postgres fires the space → expense
 * cascade before space → space_member, so the splits clear before RESTRICT is
 * checked. The explicit ordering is there because that is trigger-OID luck
 * rather than a guarantee, and asserting on Postgres's internal ordering would
 * be asserting on Postgres, not on this code.
 *
 * Runs against DATABASE_URL and skips (rather than fails) when no database is
 * reachable, so `pnpm test` still works on a bare checkout.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'

import { closeDb, getDb } from '#/lib/db'
import { describeIfDatabase } from '#/lib/test-db'
import { purgeSpace } from '#/lib/space.functions'
import {
  category,
  expense,
  expenseSplit,
  space,
  spaceInvite,
  spaceMember,
  user,
} from '#/lib/db/schema'

describe.runIf(await describeIfDatabase())('deleting a space', () => {
  const suffix = randomUUID().slice(0, 8)
  const ownerId = `test-del-owner-${suffix}`
  const doomed = randomUUID()
  const survivor = randomUUID()

  /** Everything a populated space owns, for one space id. */
  async function census(spaceId: string) {
    const db = getDb()
    const expenses = await db
      .select({ id: expense.id })
      .from(expense)
      .where(eq(expense.spaceId, spaceId))
    const splits = expenses.length
      ? await db
          .select({ id: expenseSplit.id })
          .from(expenseSplit)
          .where(
            inArray(
              expenseSplit.expenseId,
              expenses.map((e) => e.id),
            ),
          )
      : []
    return {
      spaces: await db.select({ id: space.id }).from(space),
      members: await db
        .select({ id: spaceMember.id })
        .from(spaceMember)
        .where(eq(spaceMember.spaceId, spaceId)),
      categories: await db
        .select({ id: category.id })
        .from(category)
        .where(eq(category.spaceId, spaceId)),
      invites: await db
        .select({ id: spaceInvite.id })
        .from(spaceInvite)
        .where(eq(spaceInvite.spaceId, spaceId)),
      expenses,
      splits,
    }
  }

  /** A space with one of everything, so the cascade has all four to reach. */
  async function populate(spaceId: string, label: string) {
    const db = getDb()
    const [member] = await db
      .insert(spaceMember)
      .values({
        spaceId,
        userId: ownerId,
        displayName: 'Owner',
        color: 'terracotta',
        role: 'owner',
      })
      .returning()
    const [cat] = await db
      .insert(category)
      .values({
        spaceId,
        name: `${label}-cat-${suffix}`,
        color: 'terracotta',
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
        createdByUserId: ownerId,
      })
      .returning()
    // A split, so expense_split has a row whose member_id is `restrict`-ed.
    await db.insert(expenseSplit).values({
      expenseId: row!.id,
      memberId: member!.id,
      weightBp: 10_000,
      shareMinor: 4_200,
    })
  }

  beforeAll(async () => {
    const db = getDb()
    await db.insert(user).values({
      id: ownerId,
      name: 'Owner',
      email: `del-${suffix}@test.local`,
      emailVerified: true,
    })
    await db.insert(space).values([
      {
        id: doomed,
        name: `Doomed ${suffix}`,
        currency: 'EUR',
        createdByUserId: ownerId,
      },
      {
        id: survivor,
        name: `Survivor ${suffix}`,
        currency: 'EUR',
        createdByUserId: ownerId,
      },
    ])
    await populate(doomed, 'doomed')
    await populate(survivor, 'survivor')
  })

  afterAll(async () => {
    const db = getDb()
    // Both spaces, so a failing test does not leave rows behind for the next run.
    for (const id of [doomed, survivor]) {
      await db.delete(spaceInvite).where(eq(spaceInvite.spaceId, id))
      await db.delete(expense).where(eq(expense.spaceId, id))
      await db.delete(space).where(eq(space.id, id))
    }
    await db.delete(user).where(eq(user.id, ownerId))
    await closeDb()
  })

  it('starts with both spaces fully populated', async () => {
    const before = await census(doomed)
    expect(before.expenses).toHaveLength(1)
    expect(before.splits).toHaveLength(1)
    expect(before.members).toHaveLength(1)
    expect(before.categories).toHaveLength(1)
    expect(before.invites).toHaveLength(1)
  })

  it('removes the space and everything that hangs off it', async () => {
    const result = await purgeSpace(getDb(), doomed)
    expect(result.deletedId).toBe(doomed)

    const after = await census(doomed)
    expect(after.spaces.map((s) => s.id)).not.toContain(doomed)
    // The `restrict` keys are the interesting ones: expense_split.member_id
    // and expense.category_id both point at rows this delete removes, so these
    // assertions fail if the cascade ever stops reaching them.
    expect(after.expenses).toHaveLength(0)
    expect(after.splits).toHaveLength(0)
    expect(after.members).toHaveLength(0)
    expect(after.categories).toHaveLength(0)
    expect(after.invites).toHaveLength(0)
  })

  it('leaves every other household untouched', async () => {
    const other = await census(survivor)
    expect(other.spaces.map((s) => s.id)).toContain(survivor)
    expect(other.expenses).toHaveLength(1)
    expect(other.splits).toHaveLength(1)
    expect(other.members).toHaveLength(1)
    expect(other.categories).toHaveLength(1)
    expect(other.invites).toHaveLength(1)
  })

  it('refuses a space that does not exist rather than reporting success', async () => {
    await expect(purgeSpace(getDb(), randomUUID())).rejects.toThrow('Not found')
  })
})
