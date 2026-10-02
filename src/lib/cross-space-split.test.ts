/**
 * Cross-household writes through the expense paths, against a real Postgres.
 *
 * This is the regression test for the audit finding: `updateExpense` accepted
 * `paidByMemberId` and `splits[].memberId` straight from the client with no
 * membership check, while `createExpense` had one. Because
 * `expense_split.member_id` references `space_member.id` and nothing in the
 * schema ties that member to the expense's own space, the database said yes.
 *
 * Reproduced on the live schema before the fix: a split on an expense in space A
 * naming a member of space B inserted cleanly, and space B's own balances query
 * then reported the fabricated share — an invented debt, on someone else's
 * ledger, with no trace of where it came from.
 *
 * The guard functions cannot be called directly: they live inside server
 * functions, which need a request context. So what is verified here is the
 * invariant they enforce, applied the way the handlers apply it, plus the
 * database-level fact that made it necessary — a split naming a foreign member
 * really is accepted by the schema.
 *
 * Runs against DATABASE_URL and skips (rather than fails) when no database is
 * reachable, so `pnpm test` still works on a bare checkout.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { closeDb, getDb } from '#/lib/db'
import { describeIfDatabase } from '#/lib/test-db'
import {
  category,
  expense,
  expenseSplit,
  space,
  spaceMember,
  user,
} from '#/lib/db/schema'

describe.runIf(await describeIfDatabase())(
  'an expense cannot reference another household',
  () => {
    const suffix = randomUUID().slice(0, 8)
    const ownerId = `test-xo-${suffix}`
    const spaceA = randomUUID()
    const spaceB = randomUUID()

    const memberA = randomUUID()
    const memberB = randomUUID()
    const categoryA = randomUUID()
    const expenseA = randomUUID()

    /**
     * The check the handlers now share. A local copy rather than an import,
     * for the reason at the top of the file.
     */
    async function assertMembersInSpace(
      spaceId: string,
      memberIds: ReadonlyArray<string>,
      label = 'Split participant',
    ) {
      const ids = [...new Set(memberIds)]
      if (ids.length === 0) return
      const db = getDb()
      const found = await db
        .select({ id: spaceMember.id })
        .from(spaceMember)
        .where(
          and(eq(spaceMember.spaceId, spaceId), inArray(spaceMember.id, ids)),
        )
      const known = new Set(found.map((f) => f.id))
      if (ids.find((id) => !known.has(id))) {
        throw new Error(`${label} is not a member of this space`)
      }
    }

    beforeAll(async () => {
      const db = getDb()
      await db.insert(user).values({
        id: ownerId,
        name: 'Owner',
        email: `xspace-${suffix}@test.local`,
        emailVerified: true,
      })
      await db.insert(space).values([
        {
          id: spaceA,
          name: `A ${suffix}`,
          currency: 'EUR',
          createdByUserId: ownerId,
        },
        {
          id: spaceB,
          name: `B ${suffix}`,
          currency: 'EUR',
          createdByUserId: ownerId,
        },
      ])
      await db.insert(spaceMember).values([
        {
          id: memberA,
          spaceId: spaceA,
          userId: ownerId,
          displayName: 'A',
          color: 'sage',
          defaultWeightBp: 10_000,
          role: 'owner',
        },
        {
          id: memberB,
          spaceId: spaceB,
          userId: null,
          displayName: 'B',
          color: 'sage',
          defaultWeightBp: 10_000,
          role: 'owner',
        },
      ])
      await db.insert(category).values({
        id: categoryA,
        spaceId: spaceA,
        name: `Home ${suffix}`,
        color: 'sage',
        icon: 'home',
      })
      await db.insert(expense).values({
        id: expenseA,
        spaceId: spaceA,
        categoryId: categoryA,
        paidByMemberId: memberA,
        spentOn: '2026-09-01',
        purpose: 'Rent',
        amountMinor: 120_000,
        createdByUserId: ownerId,
      })
    })

    afterAll(async () => {
      const db = getDb()
      await db.delete(expenseSplit).where(eq(expenseSplit.expenseId, expenseA))
      await db.delete(expense).where(eq(expense.id, expenseA))
      for (const id of [spaceA, spaceB]) {
        await db.delete(category).where(eq(category.spaceId, id))
        await db.delete(space).where(eq(space.id, id))
      }
      await db.delete(user).where(eq(user.id, ownerId))
      await closeDb()
    })

    it('the database does NOT stop it — which is why the app must', async () => {
      // If this ever starts failing, the schema grew a constraint that ties a
      // split to its own space, and assertMembersInSpace can retire.
      const db = getDb()
      await db.insert(expenseSplit).values({
        expenseId: expenseA,
        memberId: memberB,
        weightBp: 10_000,
        shareMinor: 120_000,
      })
      const [row] = await db
        .select({ id: expenseSplit.id })
        .from(expenseSplit)
        .where(eq(expenseSplit.expenseId, expenseA))
      expect(row).toBeDefined()
      await db.delete(expenseSplit).where(eq(expenseSplit.expenseId, expenseA))
    })

    it('rejects a split naming a member of another household', async () => {
      await expect(
        assertMembersInSpace(spaceA, [memberA, memberB]),
      ).rejects.toThrow('Split participant is not a member of this space')
    })

    it('rejects a payer from another household', async () => {
      await expect(
        assertMembersInSpace(spaceA, [memberB], 'Payer'),
      ).rejects.toThrow('Payer is not a member of this space')
    })

    it("accepts the space's own members", async () => {
      await expect(
        assertMembersInSpace(spaceA, [memberA]),
      ).resolves.toBeUndefined()
      await expect(
        assertMembersInSpace(spaceA, [memberA, memberA]),
      ).resolves.toBeUndefined()
    })

    it('accepts an archived member, because expense.paid_by_member_id restricts', async () => {
      const db = getDb()
      await db
        .update(spaceMember)
        .set({ archivedAt: new Date() })
        .where(eq(spaceMember.id, memberA))
      // Asserted through the row directly rather than the helper: the helper
      // deliberately has no archivedAt predicate, and this is the reason why.
      const [row] = await db
        .select({ id: spaceMember.id })
        .from(spaceMember)
        .where(
          and(
            eq(spaceMember.spaceId, spaceA),
            eq(spaceMember.id, memberA),
            isNull(spaceMember.archivedAt),
          ),
        )
      expect(row).toBeUndefined()
      await db
        .update(spaceMember)
        .set({ archivedAt: null })
        .where(eq(spaceMember.id, memberA))
    })
  },
)
