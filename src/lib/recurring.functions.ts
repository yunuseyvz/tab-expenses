/**
 * Repeating expenses: making the occurrences, and stopping the series.
 *
 * The scheduling lives in `recurrence.ts` and is pure. This file is the part that
 * touches the database, and it exists to do one surprisingly subtle thing:
 * create whatever is due, exactly once, from a read path.
 *
 * "Exactly once" is not enforced here. It is enforced by the unique index on
 * `(expense.recurring_id, expense.period_key)`, and the insert is an
 * `onConflictDoNothing` against it. That matters because this runs on every read
 * of the ledger: two tabs open on the first of the month are two requests that
 * both see the same month as missing, and ordering the code carefully would only
 * make the race rarer rather than impossible. Letting the database refuse the
 * second insert is the version that is actually correct.
 */
import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'

import { ensureSession, requireSpaceMember } from './auth.functions'
import { getDb } from './db'
import {
  expense,
  expenseSplit,
  recurringExpense,
  recurringExpenseSplit,
} from './db/schema'
import { uuidSchema } from './guards'
import { allocate } from './money'
import { dueOccurrences } from './recurrence'
import { today } from './period'

/**
 * Create every occurrence that is due, for one household.
 *
 * DUE MEANS ON OR BEFORE TODAY, not "this month": a series that has not been read
 * for three months produces three entries, because the rent was due on all three
 * of those dates regardless of whether anybody opened the app. The alternative —
 * one entry, dated today — would quietly delete two months of history and put the
 * wrong date on a third.
 *
 * Returns how many were created, which the tests use and nothing else does.
 */
export async function materialiseRecurring(
  spaceId: string,
  now: string = today(),
): Promise<number> {
  const db = getDb()

  const templates = await db
    .select({
      id: recurringExpense.id,
      purpose: recurringExpense.purpose,
      amountMinor: recurringExpense.amountMinor,
      categoryId: recurringExpense.categoryId,
      paidByMemberId: recurringExpense.paidByMemberId,
      frequency: recurringExpense.frequency,
      anchorDay: recurringExpense.anchorDay,
      nextDueOn: recurringExpense.nextDueOn,
      locked: recurringExpense.locked,
      createdByUserId: recurringExpense.createdByUserId,
    })
    .from(recurringExpense)
    .where(
      and(
        eq(recurringExpense.spaceId, spaceId),
        isNull(recurringExpense.archivedAt),
        // Bounded on the left by the index and on the right by the calendar: a
        // series that starts next month is not due, and asking for it on every
        // read would be the common case costing a write attempt.
        lte(recurringExpense.nextDueOn, now),
      ),
    )
    .orderBy(asc(recurringExpense.nextDueOn))

  if (templates.length === 0) return 0

  let created = 0

  for (const t of templates) {
    const weights = await db
      .select({
        memberId: recurringExpenseSplit.memberId,
        weightBp: recurringExpenseSplit.weightBp,
      })
      .from(recurringExpenseSplit)
      .where(eq(recurringExpenseSplit.recurringId, t.id))

    // A template with no participants cannot make an expense — the split would
    // sum to nothing and the write would be refused by the server's own rules.
    // Skipped rather than thrown, so one broken series does not stop the ledger
    // from loading at all.
    if (weights.length === 0) continue

    const { due, cursor } = dueOccurrences(
      t.nextDueOn,
      t.frequency,
      t.anchorDay,
      now,
    )
    if (due.length === 0) continue

    const shares = allocate(
      t.amountMinor,
      weights.map((w) => w.weightBp),
    )

    created += await db.transaction(async (tx) => {
      let made = 0
      for (const occurrence of due) {
        const [row] = await tx
          .insert(expense)
          .values({
            spaceId,
            categoryId: t.categoryId,
            paidByMemberId: t.paidByMemberId,
            spentOn: occurrence.date,
            purpose: t.purpose,
            amountMinor: t.amountMinor,
            // The series' own lock, so a generated rent arrives protected the
            // way a typed one does.
            locked: t.locked,
            // Attributed to whoever set the series up, not to nobody. Provenance
            // is what makes a read-only entry legible as somebody's.
            createdByUserId: t.createdByUserId,
            recurringId: t.id,
            periodKey: occurrence.key,
          })
          // The refusal that makes this safe to run on every read. See the file
          // header: two requests racing is the normal case, not an edge case.
          .onConflictDoNothing({
            target: [expense.recurringId, expense.periodKey],
          })
          .returning({ id: expense.id })

        // Null means the row was already there, so there is nothing to do — and
        // in particular no shares to write, which is why the splits are inside
        // this branch rather than beside it.
        if (!row) continue

        await tx.insert(expenseSplit).values(
          weights.map((w, i) => ({
            expenseId: row.id,
            memberId: w.memberId,
            weightBp: w.weightBp,
            shareMinor: shares[i]!,
          })),
        )
        made++
      }

      // The cursor moves in the same transaction as the entries it accounts for.
      // Split across two transactions, a crash in between would either re-attempt
      // the same months forever (harmless) or skip them (a lost rent).
      await tx
        .update(recurringExpense)
        .set({ nextDueOn: cursor })
        .where(eq(recurringExpense.id, t.id))

      return made
    })
  }

  return created
}

/**
 * Stop a series. Every entry it already made stays exactly as it is.
 *
 * ANY MEMBER may do this, deliberately, and it is the one place in the app where
 * that is true of something that changes the ledger. The reasoning: it only stops
 * *future* entries, deletes nothing, and rewrites nothing, so the worst a
 * housemate can do with it is save the household a rent entry it did not want.
 * Requiring the series' creator would mean a household where the person who set
 * up the rent has moved out cannot stop the rent.
 */
export const stopRecurring = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      spaceId: uuidSchema,
      expenseId: uuidSchema,
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const [row] = await db
      .select({ recurringId: expense.recurringId })
      .from(expense)
      .where(
        and(eq(expense.id, data.expenseId), eq(expense.spaceId, data.spaceId)),
      )
      .limit(1)

    if (!row?.recurringId) return { stopped: false }

    await db
      .update(recurringExpense)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(recurringExpense.id, row.recurringId),
          eq(recurringExpense.spaceId, data.spaceId),
          // Idempotent: stopping an already-stopped series must not move the
          // timestamp, which would make the row look freshly changed.
          isNull(recurringExpense.archivedAt),
        ),
      )

    return { stopped: true }
  })
