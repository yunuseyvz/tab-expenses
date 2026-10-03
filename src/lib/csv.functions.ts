/**
 * CSV export. Server function so the authorisation check runs server-side and
 * the browser only ever receives rows it was already allowed to see.
 */
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { ensureSession, requireSpaceMember } from './auth.functions'
import { getDb } from './db'
import { category, expense, spaceMember } from './db/schema'
import { toCsv } from './csv'
import { formatMinor } from './money'
import { uuidSchema } from './guards'

export const exportCsv = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ spaceId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const rows = await db
      .select({
        date: expense.spentOn,
        purpose: expense.purpose,
        amount: expense.amountMinor,
        category: category.name,
        paidBy: spaceMember.displayName,
      })
      .from(expense)
      .leftJoin(category, eq(expense.categoryId, category.id))
      .innerJoin(spaceMember, eq(expense.paidByMemberId, spaceMember.id))
      .where(
        and(eq(expense.spaceId, data.spaceId), isNull(category.archivedAt)),
      )
      .orderBy(desc(expense.spentOn), desc(expense.createdAt))

    return toCsv(
      rows.map((r) => ({
        date: r.date,
        purpose: r.purpose,
        // Export in major units as a decimal string; the minor-unit integer is
        // an internal representation and would be misleading in a spreadsheet.
        // No note column: remarks live in `expense_note` now, one entry to
        // many, and a single column cannot hold that shape. A file this writes
        // still imports — and an old file *with* a note column still imports
        // too, its note becoming the entry's first note.
        amount: formatMinor(Number(r.amount)),
        category: r.category ?? '',
        paid_by: r.paidBy,
      })),
    )
  })
