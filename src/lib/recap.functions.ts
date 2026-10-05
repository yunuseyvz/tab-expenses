/**
 * The month in review: the numbers worth looking at afterwards.
 *
 * This is the one screen in the app that is not about doing something. It is also
 * the only place where being interesting beats being terse, so it answers
 * questions a ledger does not: what was the biggest thing we bought, who has been
 * carrying the household, are we slowing down.
 *
 * Deliberately built from aggregates rather than from the expense list. The list
 * is capped at 200 rows and sorted by date, so "the biggest purchase this month"
 * read from it would be "the biggest of the most recent 200", which is the kind
 * of wrong that only shows up in a busy household — exactly the one that would
 * want a recap.
 */
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'

import { ensureSession, requireSpaceMember } from './auth.functions'
import { getDb } from './db'
import { category, expense, spaceMember } from './db/schema'
import { periodFilterSchema } from './guards'
import { materialiseRecurring } from './recurring.functions'
import { today } from './period'
import { changePercent, isWholeMonth, previousWindow } from './recap'
import type { SQL } from 'drizzle-orm'

export interface RecapHighlight {
  label: string
  amountMinor: number
  /** A category's colour, when the highlight is one. */
  color?: string
}

export interface RecapResult {
  /** Whether the range is a whole month, which is what makes the comparison fair. */
  wholeMonth: boolean
  totalMinor: number
  count: number
  previousTotalMinor: number | null
  changePercent: number | null
  biggest: RecapHighlight | null
  topCategory: RecapHighlight | null
  /** Who paid the most in the window, and how much. */
  topPayer: (RecapHighlight & { memberId: string }) | null
}

/**
 * Everything the recap card shows, or null when there is no bounded range.
 *
 * Null for "All time": a recap of all time is not a recap, and the comparison
 * window is undefined without two dates.
 */
export const getRecap = createServerFn({ method: 'GET' })
  .inputValidator(periodFilterSchema)
  .handler(async ({ data }): Promise<RecapResult | null> => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)

    if (!data.from || !data.to) return null

    // Same catch-up as every other read: a recap that missed the rent it was
    // written about would be worse than no recap.
    await materialiseRecurring(data.spaceId)

    const db = getDb()
    const todayIso = today()

    const inWindow = (from: string, to: string): Array<SQL> => [
      eq(expense.spaceId, data.spaceId),
      gte(expense.spentOn, from),
      lte(expense.spentOn, to),
    ]

    // Totals for the window, and for the window before it. The previous total is
    // computed from the same helper the label uses, so the number and the words
    // cannot disagree about which month they are comparing.
    //
    // `to` is clamped to today first, and that is load-bearing. "This month"
    // resolves to the whole calendar month — the 1st to the 31st — so a recap
    // opened on the 4th would compare four days of October against the whole of
    // September and announce that spending had collapsed. Clamping makes it four
    // days against the first four days, which is the only comparison that means
    // anything while the month is still running.
    const elapsedTo = data.to < todayIso ? data.to : todayIso
    const previous = previousWindow(data.from, elapsedTo)
    const wholeMonth = isWholeMonth(data.from, data.to) && data.to <= todayIso

    const [[current], [before]] = await Promise.all([
      db
        .select({
          total: sql<number>`coalesce(sum(${expense.amountMinor}), 0)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(expense)
        .where(and(...inWindow(data.from, data.to))),
      db
        .select({
          total: sql<number>`coalesce(sum(${expense.amountMinor}), 0)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(expense)
        .where(and(...inWindow(previous.from, previous.to))),
    ])

    const totalMinor = Number(current?.total ?? 0)
    const previousTotalMinor = Number(before?.total ?? 0)

    // The three highlights. Each is one row, ordered by the thing it is about,
    // and each is null when the window is empty rather than showing a zero.
    const [biggestRow] = await db
      .select({
        purpose: expense.purpose,
        amountMinor: expense.amountMinor,
        categoryName: category.name,
      })
      .from(expense)
      .leftJoin(category, eq(expense.categoryId, category.id))
      .where(and(...inWindow(data.from, data.to)))
      .orderBy(desc(expense.amountMinor), desc(expense.spentOn))
      .limit(1)

    const [topCategoryRow] = await db
      .select({
        name: category.name,
        color: category.color,
        total: sql<number>`coalesce(sum(${expense.amountMinor}), 0)::int`,
      })
      .from(expense)
      // Inner, so the uncategorised remainder is not reported as a category —
      // "Uncategorised" is a filter chip, not something a household spent money
      // on, and it would win often enough to make the highlight useless.
      .innerJoin(category, eq(expense.categoryId, category.id))
      .where(and(...inWindow(data.from, data.to)))
      .groupBy(category.id, category.name, category.color)
      .orderBy(desc(sql`sum(${expense.amountMinor})`))
      .limit(1)

    const [topPayerRow] = await db
      .select({
        memberId: spaceMember.id,
        displayName: spaceMember.displayName,
        total: sql<number>`coalesce(sum(${expense.amountMinor}), 0)::int`,
      })
      .from(expense)
      .innerJoin(spaceMember, eq(expense.paidByMemberId, spaceMember.id))
      .where(and(...inWindow(data.from, data.to)))
      .groupBy(spaceMember.id, spaceMember.displayName)
      .orderBy(desc(sql`sum(${expense.amountMinor})`))
      .limit(1)

    return {
      wholeMonth,
      totalMinor,
      count: Number(current?.count ?? 0),
      previousTotalMinor,
      changePercent: changePercent(totalMinor, previousTotalMinor),
      biggest: biggestRow
        ? {
            label: biggestRow.purpose,
            amountMinor: Number(biggestRow.amountMinor),
          }
        : null,
      topCategory: topCategoryRow
        ? {
            label: topCategoryRow.name,
            amountMinor: Number(topCategoryRow.total),
            color: topCategoryRow.color,
          }
        : null,
      topPayer: topPayerRow
        ? {
            memberId: topPayerRow.memberId,
            label: topPayerRow.displayName,
            amountMinor: Number(topPayerRow.total),
          }
        : null,
    } satisfies RecapResult
  })
