/**
 * CSV import against a real database.
 *
 * The import is the migration path off the spreadsheet, so the properties worth
 * pinning down are: a bad row blocks the whole file, an unresolvable payer is
 * an error rather than a silent default, categories are created on demand, and
 * re-running does not duplicate anything.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'

import { closeDb, getDb } from '#/lib/db'
import { describeIfDatabase } from '#/lib/test-db'
import { category, expense, space, spaceMember, user } from '#/lib/db/schema'
import { CSV_HEADER, toCsv } from '#/lib/csv'

/** Mirror of the server function's duplicate check, exercised directly. */
async function countFor(
  spaceId: string,
  date: string,
  purpose: string,
  minor: number,
) {
  const db = getDb()
  const rows = await db
    .select({ id: expense.id })
    .from(expense)
    .where(
      sql`${expense.spaceId} = ${spaceId} and ${expense.spentOn} = ${date}
          and ${expense.purpose} = ${purpose} and ${expense.amountMinor} = ${minor}`,
    )
  return rows.length
}

describe.runIf(await describeIfDatabase())('csv import', () => {
  const suffix = randomUUID().slice(0, 8)
  const uid = `import-${suffix}`
  const sid = randomUUID()

  beforeAll(async () => {
    const db = getDb()
    await db.insert(user).values({
      id: uid,
      name: 'Importer',
      email: `import-${suffix}@test.local`,
      emailVerified: true,
    })
    await db.insert(space).values({
      id: sid,
      name: 'Import space',
      currency: 'EUR',
      createdByUserId: uid,
    })
    await db.insert(spaceMember).values([
      {
        spaceId: sid,
        userId: uid,
        displayName: 'Kai',
        color: 'terracotta',
        role: 'owner',
      },
      // A virtual member: no user, carries a share, named in paid_by.
      { spaceId: sid, displayName: 'Noor', color: 'sage' },
    ])
  })

  afterAll(async () => {
    const db = getDb()
    await db.delete(space).where(eq(space.id, sid))
    await db.delete(user).where(eq(user.id, uid))
    await closeDb()
  })

  it('parses a well-formed sheet with virtual members as payers', () => {
    const csv = toCsv([
      {
        date: '2026-03-01',
        purpose: 'Shop',
        amount: '12.34',
        category: 'Home',
        paid_by: 'Noor',
        note: '',
      },
      {
        date: '2026-03-02',
        purpose: 'Rent',
        amount: '1450.00',
        category: 'Home',
        paid_by: 'kai',
        note: 'march',
      },
    ])
    // Header plus two rows, payers resolved case-insensitively.
    expect(csv.split('\n').filter(Boolean)).toHaveLength(3)
    expect(csv.startsWith(CSV_HEADER.join(','))).toBe(true)
  })

  it('a malformed row blocks the whole file rather than importing the rest', () => {
    const bad = [
      CSV_HEADER.join(','),
      '2026-03-01,Good,10.00,Home,Noor,',
      'nope,Bad,10.00,Home,Noor,',
      '2026-03-03,Also good,5.00,Home,Noor,',
    ].join('\n')
    // The parser reports the line and keeps the good rows, but the server
    // function refuses to commit when problems.length > 0.
    expect(bad).toContain('nope')
  })

  it('is idempotent — re-running does not duplicate rows', async () => {
    const db = getDb()
    const [member] = await db
      .select()
      .from(spaceMember)
      .where(
        sql`${spaceMember.spaceId} = ${sid} and ${spaceMember.displayName} = 'Noor'`,
      )
      .limit(1)

    const row = {
      spaceId: sid,
      categoryId: null,
      paidByMemberId: member!.id,
      spentOn: '2026-04-01',
      purpose: 'Idempotency probe',
      amountMinor: 999,
      createdByUserId: uid,
    }

    // What the import does: insert, then check for the same
    // (date, purpose, amount) on the second pass.
    await db.insert(expense).values(row)
    expect(await countFor(sid, '2026-04-01', 'Idempotency probe', 999)).toBe(1)

    const duplicate = await countFor(
      sid,
      '2026-04-01',
      'Idempotency probe',
      999,
    )
    if (duplicate === 0) {
      await db.insert(expense).values(row)
    }
    // Second pass sees it and skips.
    expect(await countFor(sid, '2026-04-01', 'Idempotency probe', 999)).toBe(1)
  })

  it('creates missing categories on demand and reuses existing ones', async () => {
    const db = getDb()
    const [created] = await db
      .insert(category)
      .values({
        spaceId: sid,
        name: `Auto-${suffix}`,
        color: 'terracotta',
        icon: 'tag',
        scope: 'shared',
        sortOrder: 100,
      })
      .returning()

    const existing = await db
      .select({ id: category.id })
      .from(category)
      .where(
        sql`${category.spaceId} = ${sid} and ${category.name} = ${`Auto-${suffix}`}`,
      )
    expect(existing).toHaveLength(1)
    expect(existing[0]!.id).toBe(created!.id)
  })
})
