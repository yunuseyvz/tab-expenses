/**
 * Notes under an entry, and the per-expense lock.
 *
 * Two additions to the expense ledger that share nothing but a migration, so
 * they share a file and nothing else. Each section states what the database
 * guarantees versus what the handler guarantees, because the split matters:
 * a constraint the column enforces holds for every writer, while a rule the
 * handler enforces holds only for callers that go through it.
 *
 * Notes:
 *   · blank and over-long bodies are refused by the column, not just the
 *     validator — a second writer that skips the schema still cannot store one.
 *   · deleting the expense deletes its notes (cascade), and deleting the
 *     author does not (set null): the conversation outlives the account.
 *   · the name is a snapshot on the row, so it survives the account too.
 *
 * Lock:
 *   · every existing row came up unlocked — the migration default, and the
 *     reason no backfill was needed.
 *   · the column is a plain boolean with no constraint beyond not-null: the
 *     "only the author may set it" rule lives in `setExpenseLock`, because a
 *     check constraint cannot see who is calling.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import postgres from 'postgres'

import { closeDb, getDb } from '#/lib/db'
import { expense, expenseNote, space, spaceMember, user } from '#/lib/db/schema'
import { describeIfDatabase } from '#/lib/test-db'

describe.runIf(await describeIfDatabase())('expense notes and locks', () => {
  const ids = {
    author: randomUUID(),
    other: randomUUID(),
    space: randomUUID(),
  }
  let memberId = ''
  let expenseId = ''

  beforeAll(async () => {
    const db = getDb()
    await db.insert(user).values([
      {
        id: ids.author,
        name: 'Alex',
        email: `notes-author-${ids.author}@test.local`,
        emailVerified: true,
      },
      {
        id: ids.other,
        name: 'Sam',
        email: `notes-other-${ids.other}@test.local`,
        emailVerified: true,
      },
    ])
    await db.insert(space).values({
      id: ids.space,
      name: 'Notes',
      currency: 'EUR',
      createdByUserId: ids.author,
    })
    const [member] = await db
      .insert(spaceMember)
      .values({
        spaceId: ids.space,
        userId: ids.author,
        displayName: 'Alex',
        color: 'terracotta',
        role: 'owner',
      })
      .returning({ id: spaceMember.id })
    memberId = member!.id

    const [row] = await db
      .insert(expense)
      .values({
        spaceId: ids.space,
        paidByMemberId: memberId,
        spentOn: '2026-06-01',
        purpose: 'Test entry',
        amountMinor: 1000,
        createdByUserId: ids.author,
      })
      .returning({ id: expense.id })
    expenseId = row!.id
  })

  afterAll(async () => {
    const db = getDb()
    await db.delete(expenseNote).where(eq(expenseNote.spaceId, ids.space))
    await db.delete(expense).where(eq(expense.spaceId, ids.space))
    await db.delete(spaceMember).where(eq(spaceMember.spaceId, ids.space))
    await db.delete(space).where(eq(space.id, ids.space))
    await db.delete(user).where(eq(user.id, ids.author))
    await db.delete(user).where(eq(user.id, ids.other))
    await closeDb()
  })

  it('leaves and reads back a note in order', async () => {
    const db = getDb()
    // Explicit timestamps a minute apart: two notes left in the same
    // millisecond share `now()`, and random UUIDs do not order by insertion —
    // so "oldest first" would be asserting on noise without them.
    await db.insert(expenseNote).values([
      {
        spaceId: ids.space,
        expenseId,
        body: 'first',
        authorUserId: ids.author,
        authorName: 'Alex',
        createdAt: new Date('2026-06-01T10:00:00Z'),
      },
      {
        spaceId: ids.space,
        expenseId,
        body: 'second',
        authorUserId: ids.other,
        authorName: 'Sam',
        createdAt: new Date('2026-06-01T10:01:00Z'),
      },
    ])

    // Same order as the server's read: time first, id as the tiebreak. Two
    // notes left in the same millisecond share a timestamp, and without the
    // tiebreak the order is whatever the database feels like.
    const rows = await db
      .select()
      .from(expenseNote)
      .where(eq(expenseNote.expenseId, expenseId))
      .orderBy(asc(expenseNote.createdAt), asc(expenseNote.id))

    expect(rows.map((r) => r.body)).toEqual(['first', 'second'])
    expect(rows[0]!.authorName).toBe('Alex')
  })

  /**
   * Through a raw client, not Drizzle: the driver wraps a failed insert as
   * "Failed query: insert into …" with the constraint name buried in the cause,
   * so asserting the name through the ORM means asserting on text it never
   * surfaces. Raw, the database names the constraint it tripped.
   */
  it('refuses a blank note at the column', async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 })
    try {
      await expect(
        client`insert into expense_note (space_id, expense_id, body, author_user_id, author_name)
                values (${ids.space}, ${expenseId}, ${'   '}, ${ids.author}, 'Alex')`,
      ).rejects.toThrow(/expense_note_body_not_blank/)
    } finally {
      await client.end({ timeout: 5 })
    }
  })

  it('refuses an over-long note at the column', async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 })
    try {
      await expect(
        client`insert into expense_note (space_id, expense_id, body, author_user_id, author_name)
                values (${ids.space}, ${expenseId}, ${'x'.repeat(2001)}, ${ids.author}, 'Alex')`,
      ).rejects.toThrow(/expense_note_body_length/)
    } finally {
      await client.end({ timeout: 5 })
    }
  })

  it('keeps the name when the author is deleted', async () => {
    const db = getDb()
    const doomed = randomUUID()
    await db.insert(user).values({
      id: doomed,
      name: 'Gone',
      email: `notes-doomed-${doomed}@test.local`,
      emailVerified: true,
    })
    const [note] = await db
      .insert(expenseNote)
      .values({
        spaceId: ids.space,
        expenseId,
        body: 'from someone leaving',
        authorUserId: doomed,
        authorName: 'Gone',
      })
      .returning({ id: expenseNote.id })

    await db.delete(user).where(eq(user.id, doomed))

    const [kept] = await db
      .select()
      .from(expenseNote)
      .where(eq(expenseNote.id, note!.id))
    // The account is gone but the remark still says who left it: a record,
    // not a gap.
    expect(kept!.authorUserId).toBeNull()
    expect(kept!.authorName).toBe('Gone')
    expect(kept!.body).toBe('from someone leaving')
  })

  it('deletes notes with their expense', async () => {
    const db = getDb()
    const doomedExpense = randomUUID()
    await db.insert(expense).values({
      id: doomedExpense,
      spaceId: ids.space,
      paidByMemberId: memberId,
      spentOn: '2026-06-02',
      purpose: 'Doomed',
      amountMinor: 500,
      createdByUserId: ids.author,
    })
    await db.insert(expenseNote).values({
      spaceId: ids.space,
      expenseId: doomedExpense,
      body: 'goes with it',
      authorUserId: ids.author,
      authorName: 'Alex',
    })

    await db.delete(expense).where(eq(expense.id, doomedExpense))

    const left = await db
      .select({ id: expenseNote.id })
      .from(expenseNote)
      .where(eq(expenseNote.expenseId, doomedExpense))
    expect(left).toEqual([])
  })

  it('unlocks every existing row by default', async () => {
    const db = getDb()
    const [row] = await db
      .select({ locked: expense.locked })
      .from(expense)
      .where(eq(expense.id, expenseId))
    expect(row!.locked).toBe(false)
  })

  it('stores a lock the author sets', async () => {
    const db = getDb()
    await db
      .update(expense)
      .set({ locked: true })
      .where(eq(expense.id, expenseId))
    const [locked] = await db
      .select({ locked: expense.locked })
      .from(expense)
      .where(eq(expense.id, expenseId))
    expect(locked!.locked).toBe(true)

    await db
      .update(expense)
      .set({ locked: false })
      .where(eq(expense.id, expenseId))
  })
})
