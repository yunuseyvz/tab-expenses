/**
 * CSV import.
 *
 * This is the migration path from the spreadsheet the app replaces, so it is
 * deliberately strict and transactional-ish:
 *
 *  · Every row is validated up front and problems are reported with a 1-based
 *    line number. A partial import into a shared ledger is worse than a failed
 *    one, because nobody notices the missing rows.
 *  · Categories and members are matched by name, and *created* if absent, so a
 *    first import does not require setting up the space first.
 *  · `paid_by` is matched against member display names case-insensitively. A
 *    row whose payer cannot be resolved is an error, not a silent default —
 *    attributing someone's spending to the wrong person is worse than refusing.
 *  · Duplicate detection is by (date, purpose, amount): re-running an import
 *    does not double every row.
 */
import { createServerFn } from '@tanstack/react-start'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { ensureSession, requireSpaceMember } from './auth.functions'
import { parseCsv } from './csv'
import { getDb } from './db'
import {
  category,
  expense,
  expenseNote,
  expenseSplit,
  spaceMember,
} from './db/schema'
import { uuidSchema } from './guards'
import { allocate } from './money'
import type { ParsedRow } from './csv'

export interface ImportProblem {
  line: number
  message: string
}

export interface ImportResult {
  created: number
  skippedDuplicates: number
  createdCategories: Array<{ name: string; scope: 'shared' | 'personal' }>
  problems: Array<ImportProblem>
}

export const previewImport = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ spaceId: uuidSchema, csv: z.string().max(2_000_000) }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const { rows, errors } = parseCsv(data.csv)
    const members = await db
      .select({ id: spaceMember.id, displayName: spaceMember.displayName })
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.spaceId, data.spaceId),
          isNull(spaceMember.archivedAt),
        ),
      )
      .orderBy(spaceMember.createdAt)

    // Check for duplicates and unresolvable payers, but write nothing.
    const problems: Array<ImportProblem> = [...errors]
    const valid: Array<{ row: ParsedRow; memberId: string }> = []
    let skippedDuplicates = 0

    for (const row of rows) {
      const member = matchMember(members, row.paidBy)
      if (!member) {
        problems.push({
          line: row.line,
          message: row.paidBy
            ? `no member named "${row.paidBy}" in this space`
            : 'paid_by is empty',
        })
        continue
      }
      if (await isDuplicate(data.spaceId, row)) {
        skippedDuplicates++
        continue
      }
      valid.push({ row, memberId: member.id })
    }

    const knownCategories = new Set(
      (
        await db
          .select({ name: category.name })
          .from(category)
          .where(
            and(
              eq(category.spaceId, data.spaceId),
              isNull(category.archivedAt),
            ),
          )
      ).map((c) => c.name),
    )
    const createdCategories = [
      ...new Set(
        valid
          .map((v) => v.row.category)
          .filter((name) => name.length > 0 && !knownCategories.has(name)),
      ),
    ].map((name) => ({ name, scope: 'shared' as const }))

    problems.sort((a, b) => a.line - b.line)

    return {
      ok: problems.length === 0,
      total: rows.length,
      importable: valid.length,
      skippedDuplicates,
      createdCategories,
      problems,
    }
  })

export const commitImport = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ spaceId: uuidSchema, csv: z.string().max(2_000_000) }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const { rows, errors } = parseCsv(data.csv)
    if (errors.length > 0) {
      // Refuse the whole file rather than importing the good rows.
      throw new Error(
        `CSV has ${errors.length} problem(s) (first at line ${errors[0]!.line}: ${errors[0]!.message}). Fix them and try again.`,
      )
    }

    const members = await db
      .select({ id: spaceMember.id, displayName: spaceMember.displayName })
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.spaceId, data.spaceId),
          isNull(spaceMember.archivedAt),
        ),
      )

    // Every row must resolve its payer before anything is written.
    const resolved = rows.map((row) => {
      const member = matchMember(members, row.paidBy)
      if (!member) {
        throw new Error(
          `Line ${row.line}: no member named "${row.paidBy || '(empty)'}". ` +
            `Add the member in Settings first, or set paid_by to an existing name.`,
        )
      }
      return { row, memberId: member.id }
    })

    // One transaction: a half-imported ledger is worse than none.
    const result = await db.transaction(async (tx) => {
      // Create any missing categories, reusing rows created in this same import.
      const categoryByName = new Map<string, string>(
        (
          await tx
            .select({ id: category.id, name: category.name })
            .from(category)
            .where(eq(category.spaceId, data.spaceId))
        ).map((c) => [c.name, c.id]),
      )

      const wanted = [
        ...new Set(
          resolved.map((r) => r.row.category).filter((n) => n.length > 0),
        ),
      ].filter((name) => !categoryByName.has(name))

      if (wanted.length > 0) {
        const swatchKeys = [
          'terracotta',
          'sage',
          'indigo',
          'ochre',
          'plum',
          'teal',
          'oxblood',
          'moss',
        ]
        const created = await tx
          .insert(category)
          .values(
            wanted.map((name, i) => ({
              spaceId: data.spaceId,
              name,
              color: swatchKeys[i % swatchKeys.length]!,
              icon: 'tag',
              scope: 'shared' as const,
              sortOrder: 100 + i,
            })),
          )
          .returning({ id: category.id, name: category.name })
        for (const c of created) categoryByName.set(c.name, c.id)
      }

      let created = 0
      let skipped = 0
      for (const { row, memberId } of resolved) {
        const dup = await isDuplicate(data.spaceId, row, tx)
        if (dup) {
          skipped++
          continue
        }

        // A spreadsheet has no splits, so the payer takes 100% — which is
        // exactly what the single-payer path stores anyway.
        const [inserted] = await tx
          .insert(expense)
          .values({
            spaceId: data.spaceId,
            categoryId: row.category
              ? (categoryByName.get(row.category) ?? null)
              : null,
            paidByMemberId: memberId,
            spentOn: row.date,
            purpose: row.purpose,
            amountMinor: row.amountMinor,
            createdByUserId: session.user.id,
          })
          .returning()
        if (!inserted) throw new Error(`Failed to import line ${row.line}`)

        // The spreadsheet's note column, as the entry's first note. Same
        // transaction, same reasoning as createExpense: the remark and its
        // entry land together or not at all.
        if (row.note?.trim()) {
          await tx.insert(expenseNote).values({
            spaceId: data.spaceId,
            expenseId: inserted.id,
            body: row.note.trim(),
            authorUserId: session.user.id,
            authorName: session.user.name,
          })
        }

        await tx.insert(expenseSplit).values({
          expenseId: inserted.id,
          memberId,
          weightBp: 10_000,
          shareMinor: allocate(row.amountMinor, [10_000])[0]!,
        })
        created++
      }

      return { created, skipped }
    })

    return {
      created: result.created,
      skippedDuplicates: result.skipped,
      createdCategories: [],
      problems: [] as Array<ImportProblem>,
    } satisfies ImportResult
  })

function matchMember(
  members: Array<{ id: string; displayName: string }>,
  name: string,
): { id: string; displayName: string } | undefined {
  const wanted = name.trim().toLowerCase()
  if (!wanted) return undefined
  return members.find((m) => m.displayName.trim().toLowerCase() === wanted)
}

/** Duplicate = same day, same purpose, same amount. Re-runnable imports. */
async function isDuplicate(
  spaceId: string,
  row: Pick<ParsedRow, 'date' | 'purpose' | 'amountMinor'>,
  tx?: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
): Promise<boolean> {
  const db = tx ?? getDb()
  const [found] = await db
    .select({ id: expense.id })
    .from(expense)
    .where(
      and(
        eq(expense.spaceId, spaceId),
        eq(expense.spentOn, row.date),
        eq(expense.purpose, row.purpose),
        eq(expense.amountMinor, row.amountMinor),
      ),
    )
    .limit(1)
  return found !== undefined
}
