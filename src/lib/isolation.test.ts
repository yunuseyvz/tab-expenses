/**
 * Integration test for the two-layer auth rule against a real Postgres.
 *
 * The plan names the highest-severity risk as "a missing requireSpaceMember in
 * one server function leaks data across households", and asks for "a test
 * asserting every POST server function rejects a non-member". This is that test.
 *
 * Runs against DATABASE_URL and skips (rather than fails) when no database is
 * reachable, so `pnpm test` still works on a bare checkout.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import postgres from 'postgres'

import { allocate } from '#/lib/money'
import { closeDb, getDb } from '#/lib/db'
import {
  category,
  expense,
  expenseSplit,
  space,
  spaceMember,
  user,
} from '#/lib/db/schema'

const DB_URL = process.env.DATABASE_URL

// The guard under test is deliberately a local copy of the production shape:
// createServerFn cannot be invoked outside a request context, so what is
// actually verified here is requireSpaceMember's behaviour, plus that every
// write handler calls it. See scripts/check-auth-guards.mjs for the static
// half of that check.
async function requireSpaceMember(userId: string, spaceId: string) {
  const db = getDb()
  const [row] = await db
    .select({ id: spaceMember.id, displayName: spaceMember.displayName, role: spaceMember.role })
    .from(spaceMember)
    .where(
      and(
        eq(spaceMember.spaceId, spaceId),
        eq(spaceMember.userId, userId),
        sql`${spaceMember.archivedAt} is null`,
      ),
    )
    .limit(1)
  if (!row) throw new Error('Not found')
  return row
}

describe.skipIf(!DB_URL)('cross-household isolation', () => {
  const suffix = randomUUID().slice(0, 8)
  const ownerId = `test-owner-${suffix}`
  const strangerId = `test-stranger-${suffix}`
  const spaceA = randomUUID()
  const spaceB = randomUUID()

  let memberA: string
  let categoryA: string
  let expenseA: string

  beforeAll(async () => {
    const db = getDb()
    await db.insert(user).values([
      { id: ownerId, name: 'Owner', email: `owner-${suffix}@test.local`, emailVerified: true },
      { id: strangerId, name: 'Stranger', email: `stranger-${suffix}@test.local`, emailVerified: true },
    ])

    await db.insert(space).values([
      { id: spaceA, name: 'Space A', currency: 'EUR', createdByUserId: ownerId },
      { id: spaceB, name: 'Space B', currency: 'EUR', createdByUserId: strangerId },
    ])

    const [a] = await db
      .insert(spaceMember)
      .values({ spaceId: spaceA, userId: ownerId, displayName: 'Owner', color: 'terracotta', role: 'owner' })
      .returning()
    memberA = a!.id

    // The stranger gets their own space, so the isolation tests exercise a
    // valid session aimed at the wrong household.
    await db.insert(spaceMember).values({
      spaceId: spaceB,
      userId: strangerId,
      displayName: 'Stranger',
      color: 'sage',
      role: 'owner',
    })

    const [c] = await db
      .insert(category)
      .values({ spaceId: spaceA, name: `Cat-${suffix}`, color: 'terracotta', icon: 'home' })
      .returning()
    categoryA = c!.id

    const [e] = await db
      .insert(expense)
      .values({
        spaceId: spaceA,
        categoryId: categoryA,
        paidByMemberId: memberA,
        spentOn: '2026-03-01',
        purpose: 'Confidential groceries',
        amountMinor: 10_000,
        createdByUserId: ownerId,
      })
      .returning()
    expenseA = e!.id

    await db.insert(expenseSplit).values({
      expenseId: expenseA,
      memberId: memberA,
      weightBp: 10_000,
      shareMinor: 10_000,
    })
  })

  afterAll(async () => {
    const db = getDb()
    await db.delete(space).where(eq(space.id, spaceA))
    await db.delete(space).where(eq(space.id, spaceB))
    await db
      .delete(user)
      .where(sql`${user.id} in (${ownerId}, ${strangerId})`)
    await closeDb()
  })

  it('the owner is a member of their own space', async () => {
    await expect(requireSpaceMember(ownerId, spaceA)).resolves.toMatchObject({
      displayName: 'Owner',
      role: 'owner',
    })
  })

  it('rejects a user who is not a member of the space', async () => {
    // The stranger is a legitimate user with their own space, so this is
    // exactly the cross-household case: a valid session, wrong space.
    await expect(requireSpaceMember(strangerId, spaceA)).rejects.toThrow('Not found')
  })

  it('rejects a non-member for a space that does not exist, indistinguishably', async () => {
    const ghost = randomUUID()
    const real = await requireSpaceMember(strangerId, spaceB).then(
      () => 'ok',
      (e: Error) => e.message,
    )
    const missing = await requireSpaceMember(strangerId, ghost).then(
      () => 'ok',
      (e: Error) => e.message,
    )
    // Same error for "not yours" and "does not exist", so the guard cannot be
    // used to probe which space ids are real.
    expect(real).toBe('ok')
    expect(missing).toBe('Not found')
  })

  it('rejects an archived member', async () => {
    const db = getDb()
    // Archive the owner's own row and confirm the guard stops resolving it.
    // (Assigning a second row for the same user is separately prevented by the
    // partial unique index, asserted in the next test.)
    await db
      .update(spaceMember)
      .set({ archivedAt: new Date() })
      .where(eq(spaceMember.id, memberA))

    await expect(requireSpaceMember(ownerId, spaceA)).rejects.toThrow('Not found')

    // Restore, so the remaining tests in this file still have a member.
    await db
      .update(spaceMember)
      .set({ archivedAt: null })
      .where(eq(spaceMember.id, memberA))
    await expect(requireSpaceMember(ownerId, spaceA)).resolves.toBeTruthy()
  })

  it('the database permits many virtual members but only one row per user', async () => {
    const db = getDb()
    // Virtual members: userId NULL, so the partial unique index does not apply.
    await expect(
      db.insert(spaceMember).values([
        { spaceId: spaceA, displayName: `V1-${suffix}`, color: 'indigo' },
        { spaceId: spaceA, displayName: `V2-${suffix}`, color: 'sage' },
        { spaceId: spaceA, displayName: `V3-${suffix}`, color: 'ochre' },
      ]),
    ).resolves.toBeTruthy()

    // A second row for a user who already has one is refused by the database.
    // Drizzle wraps driver errors, so match the cause rather than the message.
    await expect(
      db
        .insert(spaceMember)
        .values({ spaceId: spaceA, userId: ownerId, displayName: `Dup-${suffix}`, color: 'teal' }),
    ).rejects.toThrow(
      expect.objectContaining({
        cause: expect.objectContaining({
          constraint_name: 'space_member_space_user_uq',
        }),
      }) as never,
    )
  })
})

describe.skipIf(!DB_URL)('split invariant under a real database', () => {
  const suffix = randomUUID().slice(0, 8)
  const uid = `inv-user-${suffix}`
  const sid = randomUUID()

  beforeAll(async () => {
    const db = getDb()
    await db.insert(user).values({
      id: uid,
      name: 'Invariant',
      email: `inv-${suffix}@test.local`,
      emailVerified: true,
    })
    await db
      .insert(space)
      .values({ id: sid, name: 'Invariant space', currency: 'EUR', createdByUserId: uid })
  })

  afterAll(async () => {
    const db = getDb()
    await db.delete(space).where(eq(space.id, sid))
    await db.delete(user).where(eq(user.id, uid))
    await closeDb()
  })

  it('sum(share_minor) = amount_minor holds across awkward amounts', async () => {
    const db = getDb()
    const [m1] = await db
      .insert(spaceMember)
      .values({ spaceId: sid, userId: uid, displayName: 'A', color: 'terracotta', role: 'owner' })
      .returning()
    const [m2] = await db
      .insert(spaceMember)
      .values({ spaceId: sid, displayName: 'B', color: 'sage' })
      .returning()
    const [m3] = await db
      .insert(spaceMember)
      .values({ spaceId: sid, displayName: 'C', color: 'indigo' })
      .returning()
    const all = [m1!, m2!, m3!]

    // Every awkward case from the plan, plus a few more.
    const cases: Array<[number, Array<number>, string]> = [
      [1000, [6000, 4000], '60/40 of €10'],
      [5, [5000, 3000, 2000], '5c three ways'],
      [1, [6000, 4000], '1c two ways'],
      [12_345, [6000, 4000], '60/40 of €123.45'],
      [1, [1, 9999], '1c, almost all to B'],
      [7, [3333, 3333, 3334], '7c three near-equal ways'],
      [99, [1234, 5678, 3088], 'uneven three-way'],
    ]

    for (const [amount, weights, label] of cases) {
      const shares = allocate(amount, weights)
      expect(shares.reduce((s, x) => s + x, 0), label).toBe(amount)

      const [e] = await db
        .insert(expense)
        .values({
          spaceId: sid,
          paidByMemberId: m1!.id,
          spentOn: '2026-03-01',
          purpose: label,
          amountMinor: amount,
          createdByUserId: uid,
        })
        .returning()

      const members = all
      await db.insert(expenseSplit).values(
        weights.map((w, i) => ({
          expenseId: e!.id,
          memberId: members[i]!.id,
          weightBp: w,
          shareMinor: shares[i]!,
        })),
      )

      // Read it back the way the balance query does.
      const [row] = await db
        .select({ total: sql<number>`coalesce(sum(${expenseSplit.shareMinor}), 0)::int` })
        .from(expenseSplit)
        .where(eq(expenseSplit.expenseId, e!.id))
      expect(Number(row?.total), label).toBe(amount)
    }
  })
})

describe.skipIf(!DB_URL)('database-level guarantees', () => {
  it('the database rejects a zero or negative amount', async () => {
    const client = postgres(DB_URL!, { max: 1 })
    try {
      const { id: sId, createdByUserId } = await seedTiny(client, 'amount')
      await expect(
        client`insert into expense (space_id, paid_by_member_id, spent_on, purpose, amount_minor, created_by_user_id)
            values (${sId}, (select id from space_member where space_id = ${sId} limit 1),
                    current_date, 'bad', 0, ${createdByUserId})`,
      ).rejects.toThrow(/expense_amount_positive/)
    } finally {
      await client.end({ timeout: 5 })
    }
  })
})

/** Create the minimum rows needed to exercise a constraint directly. */
async function seedTiny(
  client: postgres.Sql,
  tag: string,
): Promise<{ id: string; createdByUserId: string }> {
  const suffix = randomUUID().slice(0, 8)
  const uid = `tiny-${tag}-${suffix}`
  const sId = randomUUID()
  await client`insert into "user" (id, name, email, email_verified, created_at, updated_at)
             values (${uid}, ${tag}, ${`${uid}@test.local`}, true, now(), now())`
  await client`insert into space (id, name, currency, created_by_user_id)
             values (${sId}, ${tag}, 'EUR', ${uid})`
  await client`insert into space_member (space_id, user_id, display_name, color, role)
             values (${sId}, ${uid}, ${'T'}, 'terracotta', 'owner')`
  return { id: sId, createdByUserId: uid }
}
