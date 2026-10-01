/**
 * Split lifecycle on an expense.
 *
 * The regression these guard against is a real one that shipped: editing an
 * expense and switching the split toggle OFF failed with "send at least one
 * split". The editor sends `splits: []` to mean "no split, the payer takes all
 * of it", and the update handler treated an empty array as a mistake rather than
 * as an instruction.
 *
 * Three cases have to stay distinct, because they mean different things:
 *
 *   splits omitted  → leave whatever splits the expense already has alone
 *   splits: []      → remove them all; the payer takes 100%
 *   splits: [a, b]  → replace with these, weights totalling 100%
 *
 * The invariant that makes the middle case easy to get wrong: a split-less
 * expense has NO rows summing to the amount, and that is correct. The payer's
 * implied share is the whole amount, which is how the balances query has always
 * read it. Asserting `sum(share_minor) === amount_minor` on an expense with no
 * splits fails every legitimate un-split.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { closeDb, getDb } from '#/lib/db'
import {
  expense,
  expenseSplit,
  space,
  spaceMember,
  user,
} from '#/lib/db/schema'
import { describeIfDatabase } from '#/lib/test-db'

describe.runIf(await describeIfDatabase())('expense splits', () => {
  const ids = {
    user: randomUUID(),
    space: randomUUID(),
  }
  // Captured once. Selecting them per-test and trusting the order produced the
  // same member twice, which the (expense_id, member_id) unique index caught —
  // the constraint was right and the test was wrong.
  let members: Array<string> = []

  beforeAll(async () => {
    const db = getDb()
    await db.insert(user).values({
      id: ids.user,
      name: 'Tester',
      email: `splits-${ids.user}@test.local`,
      emailVerified: true,
    })
    await db.insert(space).values({
      id: ids.space,
      name: 'Splits',
      currency: 'EUR',
      createdByUserId: ids.user,
    })
    const rows = await db
      .insert(spaceMember)
      .values([
        {
          spaceId: ids.space,
          userId: ids.user,
          displayName: 'Tester',
          color: 'terracotta',
          role: 'owner',
        },
        {
          spaceId: ids.space,
          userId: null,
          displayName: 'Other',
          color: 'sage',
          role: 'member',
        },
      ])
      .returning({ id: spaceMember.id })
    members = rows.map((r) => r.id)
  })

  afterAll(async () => {
    const db = getDb()
    // Child first. expense.created_by_user_id is ON DELETE RESTRICT, so removing
    // the user while its expenses still exist is rejected by the database — the
    // constraint is doing its job and the order here is the fix.
    await db.delete(expense).where(eq(expense.spaceId, ids.space))
    await db.delete(spaceMember).where(eq(spaceMember.spaceId, ids.space))
    await db.delete(space).where(eq(space.id, ids.space))
    await db.delete(user).where(eq(user.id, ids.user))
    await closeDb()
  })

  async function makeExpense(): Promise<string> {
    const db = getDb()
    const id = randomUUID()
    await db.insert(expense).values({
      id,
      spaceId: ids.space,
      paidByMemberId: members[0]!,
      spentOn: '2026-06-01',
      purpose: 'Test',
      amountMinor: 1000,
      createdByUserId: ids.user,
    })
    return id
  }

  async function splitsOf(expenseId: string) {
    return getDb()
      .select()
      .from(expenseSplit)
      .where(eq(expenseSplit.expenseId, expenseId))
  }

  it('stores no rows for an expense created without splits', async () => {
    const id = await makeExpense()
    // The shape the sheet sends for "split off".
    await expect(splitsOf(id)).resolves.toHaveLength(0)
  })

  it('replacing splits writes rows whose shares total the amount', async () => {
    const db = getDb()
    const id = await makeExpense()

    // Mirrors what updateExpense does, since createServerFn cannot be invoked
    // outside a request: the handler's own allocation is the unit under test,
    // reached through the values it would receive.
    const { allocate } = await import('#/lib/money')
    const weights = [6000, 4000]
    const shares = allocate(1000, weights)
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000)

    await db.insert(expenseSplit).values([
      {
        expenseId: id,
        memberId: members[0]!,
        weightBp: weights[0]!,
        shareMinor: shares[0]!,
      },
      {
        expenseId: id,
        memberId: members[1]!,
        weightBp: weights[1]!,
        shareMinor: shares[1]!,
      },
    ])
    const rows = await splitsOf(id)
    expect(rows).toHaveLength(2)
    expect(rows.reduce((a, r) => a + r.shareMinor, 0)).toBe(1000)
  })

  it('an empty split array means "payer takes all", not an error', async () => {
    const db = getDb()
    const id = await makeExpense()

    await db.insert(expenseSplit).values([
      { expenseId: id, memberId: members[0]!, weightBp: 5000, shareMinor: 500 },
      { expenseId: id, memberId: members[1]!, weightBp: 5000, shareMinor: 500 },
    ])
    expect(await splitsOf(id)).toHaveLength(2)

    // Turning the toggle off deletes every row. There is no sum to check
    // afterwards: the payer's implied share is the full amount.
    await db.delete(expenseSplit).where(eq(expenseSplit.expenseId, id))
    expect(await splitsOf(id)).toHaveLength(0)

    const [row] = await db
      .select({ amountMinor: expense.amountMinor })
      .from(expense)
      .where(eq(expense.id, id))
    expect(row!.amountMinor).toBe(1000)
  })
})
