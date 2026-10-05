/**
 * Deleting a space, against a real Postgres.
 *
 * This is the only irreversible operation in the app, so it gets a real test
 * rather than a click-through. Two things are being asserted, and only the
 * first one is obvious:
 *
 *   1. The cascade reaches every table. A `restrict` foreign key is correct for
 *      archiving and is exactly the kind of thing that turns a delete into a
 *      foreign key violation, so the assertion is on the rows being gone, not on
 *      the call returning.
 *
 *      "Every" is the operative word and it is there because this file was the
 *      reason the bug survived. It asserted on five tables while the schema had
 *      seven, because settlements and recurring series were added after it was
 *      written — so `Delete space` died on a foreign key violation for any
 *      household that had recorded a payment or a rent, which is nearly all of
 *      them. Adding a table with a member-keyed `restrict` now means adding it
 *      here too, or the test keeps passing while the button breaks.
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
  recurringExpense,
  recurringExpenseSplit,
  settlement,
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
      settlements: await db
        .select({ id: settlement.id })
        .from(settlement)
        .where(eq(settlement.spaceId, spaceId)),
      series: await db
        .select({ id: recurringExpense.id })
        .from(recurringExpense)
        .where(eq(recurringExpense.spaceId, spaceId)),
      seriesSplits: await db
        .select({ id: recurringExpenseSplit.id })
        .from(recurringExpenseSplit)
        .where(
          inArray(
            recurringExpenseSplit.recurringId,
            (
              await db
                .select({ id: recurringExpense.id })
                .from(recurringExpense)
                .where(eq(recurringExpense.spaceId, spaceId))
            ).map((r) => r.id),
          ),
        ),
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

    /*
     * The two that were missed. Both restrict on member_id, so a household with
     * either of them could not be deleted at all — see the note at the top. A
     * second member is needed because settlement.from_member_id and
     * to_member_id refuse to be the same person.
     */
    const [other] = await db
      .insert(spaceMember)
      .values({
        spaceId,
        userId: null,
        displayName: 'Other',
        color: 'sage',
        defaultWeightBp: 0,
        role: 'member',
      })
      .returning()

    await db.insert(settlement).values({
      spaceId,
      fromMemberId: other!.id,
      toMemberId: member!.id,
      amountMinor: 1_500,
      settledOn: '2026-09-02',
      createdByUserId: ownerId,
    })

    const [series] = await db
      .insert(recurringExpense)
      .values({
        spaceId,
        purpose: `${label} rent ${suffix}`,
        amountMinor: 90_000,
        categoryId: cat!.id,
        paidByMemberId: member!.id,
        frequency: 'monthly',
        anchorDay: 1,
        startsOn: '2026-01-01',
        nextDueOn: '2026-12-01',
        createdByUserId: ownerId,
      })
      .returning()
    await db.insert(recurringExpenseSplit).values({
      recurringId: series!.id,
      memberId: other!.id,
      weightBp: 10_000,
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
      await db.delete(recurringExpense).where(eq(recurringExpense.spaceId, id))
      await db.delete(expense).where(eq(expense.spaceId, id))
      await db.delete(settlement).where(eq(settlement.spaceId, id))
      await db.delete(space).where(eq(space.id, id))
    }
    await db.delete(user).where(eq(user.id, ownerId))
    await closeDb()
  })

  it('starts with both spaces fully populated', async () => {
    const before = await census(doomed)
    expect(before.expenses).toHaveLength(1)
    expect(before.splits).toHaveLength(1)
    expect(before.members).toHaveLength(2)
    expect(before.categories).toHaveLength(1)
    expect(before.invites).toHaveLength(1)
    expect(before.settlements).toHaveLength(1)
    expect(before.series).toHaveLength(1)
    expect(before.seriesSplits).toHaveLength(1)
  })

  it('removes the space and everything that hangs off it', async () => {
    const result = await purgeSpace(getDb(), doomed)
    expect(result.deletedId).toBe(doomed)

    const after = await census(doomed)
    expect(after.spaces.map((s) => s.id)).not.toContain(doomed)
    // The `restrict` keys are the interesting ones: expense_split.member_id,
    // expense.category_id, settlement.from_member_id and
    // recurring_expense_split.member_id all point at rows this delete removes, so
    // these assertions fail if the cascade ever stops reaching them — or if a new
    // table is added with a member key and not listed here.
    expect(after.expenses).toHaveLength(0)
    expect(after.splits).toHaveLength(0)
    expect(after.settlements).toHaveLength(0)
    expect(after.series).toHaveLength(0)
    expect(after.seriesSplits).toHaveLength(0)
    expect(after.members).toHaveLength(0)
    expect(after.categories).toHaveLength(0)
    expect(after.invites).toHaveLength(0)
  })

  it('leaves every other household untouched', async () => {
    const other = await census(survivor)
    expect(other.spaces.map((s) => s.id)).toContain(survivor)
    expect(other.expenses).toHaveLength(1)
    expect(other.splits).toHaveLength(1)
    expect(other.members).toHaveLength(2)
    expect(other.categories).toHaveLength(1)
    expect(other.invites).toHaveLength(1)
    expect(other.settlements).toHaveLength(1)
    expect(other.series).toHaveLength(1)
    expect(other.seriesSplits).toHaveLength(1)
  })

  it('refuses a space that does not exist rather than reporting success', async () => {
    await expect(purgeSpace(getDb(), randomUUID())).rejects.toThrow('Not found')
  })
})
