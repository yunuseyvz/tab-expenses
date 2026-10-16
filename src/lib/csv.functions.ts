/**
 * CSV export. Server function so the authorisation check runs server-side and
 * the browser only ever receives rows it was already allowed to see.
 *
 * ── on the shares column ─────────────────────────────────────────────────────
 *
 * The export used to be five columns: date, purpose, amount, category, payer.
 * That is a list of what was bought and is useless for the one question anybody
 * exports a ledger to answer — who owes whom. It could not be checked, and it
 * could not be moved anywhere else.
 *
 * So every row now carries WHO OWES WHAT, as `Name:12.34;Other:7.66`. One column
 * rather than one column per member, because the roster is not fixed and a header
 * that changes shape with the household is not something a spreadsheet can be
 * pointed at twice.
 *
 * It is written so the file checks itself: the shares in a row always total that
 * row's amount. An expense with no split rows — "nobody is sharing this" — gets
 * the payer's implied share of the whole amount rather than an empty cell, so
 * there is no row where the column is blank and the arithmetic quietly stops
 * working. That is the whole reason the implied share exists in the balances, and
 * it is right to export it too rather than to export a different, simpler lie.
 *
 * Adding columns is safe for the importer: it locates what it needs by header
 * name and ignores the rest, so a file written here still imports, and so does an
 * old file that arrives without the new columns.
 */
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { ensureSession, requireSpaceMember } from './auth.functions'
import { getDb } from './db'
import { category, expense, expenseSplit, spaceMember } from './db/schema'
import { toCsv } from './csv'
import { formatMinor } from './money'
import { uuidSchema } from './guards'

/** `Name:12.34;Other:7.66` — one field per sharer, in roster order. */
function encodeShares(parts: Array<{ name: string; minor: number }>): string {
  return parts.map((p) => `${p.name}:${formatMinor(p.minor)}`).join(';')
}

export const exportCsv = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ spaceId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const expenses = await db
      .select({
        id: expense.id,
        date: expense.spentOn,
        purpose: expense.purpose,
        amount: expense.amountMinor,
        category: category.name,
        paidByMemberId: spaceMember.id,
        paidBy: spaceMember.displayName,
      })
      .from(expense)
      .leftJoin(category, eq(expense.categoryId, category.id))
      .innerJoin(spaceMember, eq(expense.paidByMemberId, spaceMember.id))
      .where(
        and(eq(expense.spaceId, data.spaceId), isNull(category.archivedAt)),
      )
      .orderBy(desc(expense.spentOn), desc(expense.createdAt))

    /*
     * The splits as their own query rather than a second join. Joining
     * expense_split and the sharer onto the same select would give one row per
     * split and repeat the expense once per sharer, which is fine for counting
     * and catastrophic for an export: the amounts would be duplicated and the
     * file's own column would no longer sum to the ledger.
     */
    const ids = expenses.map((e) => e.id)
    const splitRows = ids.length
      ? await db
          .select({
            expenseId: expenseSplit.expenseId,
            memberId: spaceMember.id,
            displayName: spaceMember.displayName,
            shareMinor: expenseSplit.shareMinor,
          })
          .from(expenseSplit)
          .innerJoin(spaceMember, eq(expenseSplit.memberId, spaceMember.id))
          .where(inArray(expenseSplit.expenseId, ids))
      : []

    // Archived members are named here even though they are off the roster: a
    // share has to keep its name after the person, which is the same rule the
    // roster and the ledger follow, and an export that dropped the row would make
    // the file's own shares fail to total.
    const byExpense = new Map<
      string,
      Array<{ memberId: string; name: string; minor: number }>
    >()
    for (const s of splitRows) {
      const list = byExpense.get(s.expenseId) ?? []
      list.push({
        memberId: s.memberId,
        name: s.displayName,
        minor: Number(s.shareMinor),
      })
      byExpense.set(s.expenseId, list)
    }

    return toCsv(
      expenses.map((e) => {
        const shares = byExpense.get(e.id) ?? []
        // No split rows means nobody is sharing this, and the payer's implied
        // share is the whole amount. See the note at the top of the file.
        const encoded =
          shares.length > 0
            ? encodeShares(shares)
            : encodeShares([{ name: e.paidBy, minor: Number(e.amount) }])
        return {
          date: e.date,
          purpose: e.purpose,
          // Export in major units as a decimal string; the minor-unit integer is
          // an internal representation and would be misleading in a spreadsheet.
          //
          // No note column: remarks live in `expense_note` now, one entry to
          // many, and a single column cannot hold that shape. A file this writes
          // still imports — and an old file *with* a note column still imports
          // too, its note becoming the entry's first note.
          amount: formatMinor(Number(e.amount)),
          category: e.category ?? '',
          paid_by: e.paidBy,
          shares: encoded,
        }
      }),
    )
  })
