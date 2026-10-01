/**
 * Expenses, splits, totals and balances.
 *
 * The split write is the load-bearing part. `weightBp` is the editable intent
 * and `shareMinor` the derived cents, computed once in the same transaction as
 * the expense so that sum(share_minor) = amount_minor is an invariant rather
 * than a convention. The invariant is re-checked inside the transaction before
 * commit, so a bug in `allocate` cannot silently corrupt the ledger.
 */
import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'

import { ensureSession, requireSpaceMember } from './auth.functions'
import { getDb } from './db'
import { category, expense, expenseSplit, spaceMember } from './db/schema'
import { expenseInputSchema, periodFilterSchema, uuidSchema } from './guards'
import { BP_TOTAL, allocate, parseAmountToMinor } from './money'
import { settle } from './settle'
import type { Settlement } from './settle'

export interface SplitRow {
  memberId: string
  displayName: string
  color: string
  weightBp: number
  shareMinor: number
}

export interface ExpenseRow {
  id: string
  spaceId: string
  amountMinor: number
  spentOn: string
  purpose: string
  note: string | null
  categoryId: string | null
  categoryName: string | null
  categoryColor: string | null
  categoryIcon: string | null
  categoryScope: 'shared' | 'personal' | null
  paidByMemberId: string
  paidByName: string
  paidByColor: string
  createdByUserId: string
  createdAt: string
  splits: Array<SplitRow>
}

/** Shared SELECT: expenses joined to their category and payer. */
function expenseSelect() {
  return {
    id: expense.id,
    spaceId: expense.spaceId,
    amountMinor: expense.amountMinor,
    spentOn: expense.spentOn,
    purpose: expense.purpose,
    note: expense.note,
    categoryId: expense.categoryId,
    categoryName: category.name,
    categoryColor: category.color,
    categoryIcon: category.icon,
    categoryScope: category.scope,
    paidByMemberId: expense.paidByMemberId,
    paidByName: spaceMember.displayName,
    paidByColor: spaceMember.color,
    createdByUserId: expense.createdByUserId,
    createdAt: expense.createdAt,
  }
}

/** Splits for a set of expenses, in one query rather than N. */
async function splitsFor(
  spaceId: string,
  expenseIds: Array<string>,
): Promise<Map<string, Array<SplitRow>>> {
  const byExpense = new Map<string, Array<SplitRow>>()
  if (expenseIds.length === 0) return byExpense

  const db = getDb()
  const rows = await db
    .select({
      expenseId: expenseSplit.expenseId,
      memberId: expenseSplit.memberId,
      displayName: spaceMember.displayName,
      color: spaceMember.color,
      weightBp: expenseSplit.weightBp,
      shareMinor: expenseSplit.shareMinor,
    })
    .from(expenseSplit)
    .innerJoin(spaceMember, eq(expenseSplit.memberId, spaceMember.id))
    .where(
      and(
        eq(spaceMember.spaceId, spaceId),
        inArray(expenseSplit.expenseId, expenseIds),
      ),
    )
    .orderBy(asc(expenseSplit.memberId))

  for (const r of rows) {
    const list = byExpense.get(r.expenseId)
    const entry: SplitRow = {
      memberId: r.memberId,
      displayName: r.displayName,
      color: r.color,
      weightBp: r.weightBp,
      shareMinor: r.shareMinor,
    }
    if (list) list.push(entry)
    else byExpense.set(r.expenseId, [entry])
  }
  return byExpense
}

// ── writes ────────────────────────────────────────────────────────────────

export const createExpense = createServerFn({ method: 'POST' })
  .inputValidator(expenseInputSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const amountMinor = parseAmountToMinor(data.amount)

    // Payer must be an active member of this space.
    const payer = await db
      .select({ id: spaceMember.id })
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.id, data.paidByMemberId),
          eq(spaceMember.spaceId, data.spaceId),
          isNull(spaceMember.archivedAt),
        ),
      )
      .limit(1)
    if (!payer[0]) throw new Error('Payer is not a member of this space')

    // Category, when given, must belong to this space.
    if (data.categoryId) {
      const cat = await db
        .select({ id: category.id })
        .from(category)
        .where(
          and(
            eq(category.id, data.categoryId),
            eq(category.spaceId, data.spaceId),
          ),
        )
        .limit(1)
      if (!cat[0]) throw new Error('Category is not in this space')
    }

    // No splits → single payer takes 100%.
    const splits =
      data.splits.length === 0
        ? [{ memberId: data.paidByMemberId, weightBp: BP_TOTAL }]
        : data.splits

    const weightSum = splits.reduce((s, r) => s + r.weightBp, 0)
    if (weightSum !== BP_TOTAL) {
      throw new Error(`Split weights must total 100%, got ${weightSum / 100}%`)
    }

    // Duplicate member rows would violate the unique index; catch it here with
    // a clear message instead of surfacing a constraint violation.
    const seen = new Set<string>()
    for (const s of splits) {
      if (seen.has(s.memberId)) throw new Error('Duplicate member in split')
      seen.add(s.memberId)
    }

    // Every split participant must be a member of this space — checked in one
    // query rather than one per row.
    const participants = await db
      .select({ id: spaceMember.id })
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.spaceId, data.spaceId),
          inArray(spaceMember.id, splits.map((s) => s.memberId)),
        ),
      )
    const known = new Set(participants.map((p) => p.id))
    for (const s of splits) {
      if (!known.has(s.memberId)) {
        throw new Error('Split participant is not a member of this space')
      }
    }

    const shares = allocate(amountMinor, splits.map((s) => s.weightBp))

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(expense)
        .values({
          spaceId: data.spaceId,
          categoryId: data.categoryId,
          paidByMemberId: data.paidByMemberId,
          spentOn: data.spentOn,
          purpose: data.purpose,
          amountMinor,
          note: data.note,
          createdByUserId: session.user.id,
        })
        .returning()
      if (!row) throw new Error('Failed to create expense')

      await tx.insert(expenseSplit).values(
        splits.map((s, i) => ({
          expenseId: row.id,
          memberId: s.memberId,
          weightBp: s.weightBp,
          shareMinor: shares[i]!,
        })),
      )

      // Re-assert the invariant against what actually landed in the table.
      const [check] = await tx
        .select({ total: sql<number>`coalesce(sum(${expenseSplit.shareMinor}), 0)::int` })
        .from(expenseSplit)
        .where(eq(expenseSplit.expenseId, row.id))

      if (Number(check?.total ?? 0) !== amountMinor) {
        throw new Error(
          `Split invariant violated: shares sum to ${check?.total}, expected ${amountMinor}`,
        )
      }

      return row
    })

    return { id: created.id, amountMinor }
  })

export const updateExpense = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      spaceId: uuidSchema,
      expenseId: uuidSchema,
      amount: z.string().trim().optional(),
      categoryId: uuidSchema.nullable().optional(),
      paidByMemberId: uuidSchema.optional(),
      spentOn: z.string().trim().optional(),
      purpose: z.string().trim().min(1).max(200).optional(),
      note: z.string().trim().max(500).nullable().optional(),
      splits: z
        .array(
          z.object({
            memberId: uuidSchema,
            weightBp: z.number().int().min(0).max(BP_TOTAL),
          }),
        )
        .max(50)
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const [existing] = await db
      .select()
      .from(expense)
      .where(and(eq(expense.id, data.expenseId), eq(expense.spaceId, data.spaceId)))
      .limit(1)
    if (!existing) throw new Error('Not found')

    const amountMinor =
      data.amount !== undefined ? parseAmountToMinor(data.amount) : existing.amountMinor
    const paidByMemberId = data.paidByMemberId ?? existing.paidByMemberId

    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(expense)
        .set({
          amountMinor,
          categoryId: data.categoryId !== undefined ? data.categoryId : existing.categoryId,
          paidByMemberId,
          spentOn: data.spentOn ?? existing.spentOn,
          purpose: data.purpose ?? existing.purpose,
          note: data.note !== undefined ? data.note : existing.note,
        })
        .where(eq(expense.id, data.expenseId))
        .returning()
      if (!row) throw new Error('Not found')

      // Splits are only rewritten when explicitly supplied. A weight edit
      // re-derives the shares, which is why share_minor is stored rather than
      // recomputed at read time.
      if (data.splits !== undefined) {
        const splits = data.splits
        if (splits.length === 0) {
          throw new Error('Send at least one split, or omit splits entirely')
        }
        const weightSum = splits.reduce((s, r) => s + r.weightBp, 0)
        if (weightSum !== BP_TOTAL) {
          throw new Error(`Split weights must total 100%, got ${weightSum / 100}%`)
        }

        const seen = new Set<string>()
        for (const s of splits) {
          if (seen.has(s.memberId)) throw new Error('Duplicate member in split')
          seen.add(s.memberId)
        }

        const shares = allocate(amountMinor, splits.map((s) => s.weightBp))

        await tx.delete(expenseSplit).where(eq(expenseSplit.expenseId, data.expenseId))
        await tx.insert(expenseSplit).values(
          splits.map((s, i) => ({
            expenseId: data.expenseId,
            memberId: s.memberId,
            weightBp: s.weightBp,
            shareMinor: shares[i]!,
          })),
        )

        const [check] = await tx
          .select({ total: sql<number>`coalesce(sum(${expenseSplit.shareMinor}), 0)::int` })
          .from(expenseSplit)
          .where(eq(expenseSplit.expenseId, data.expenseId))
        if (Number(check?.total ?? 0) !== amountMinor) {
          throw new Error('Split invariant violated on update')
        }
      }

      return row
    })
  })

export const deleteExpense = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ spaceId: uuidSchema, expenseId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    // expense_split rows cascade; scoping the delete by spaceId stops a
    // guessed id from removing another space's expense.
    const deleted = await db
      .delete(expense)
      .where(and(eq(expense.id, data.expenseId), eq(expense.spaceId, data.spaceId)))
      .returning({ id: expense.id })

    if (deleted.length === 0) throw new Error('Not found')
    return { ok: true }
  })

// ── reads ─────────────────────────────────────────────────────────────────

export const listExpenses = createServerFn({ method: 'GET' })
  .inputValidator(periodFilterSchema.extend({ limit: z.number().int().min(1).max(500).default(200) }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const conditions = [eq(expense.spaceId, data.spaceId)]
    if (data.from) conditions.push(gte(expense.spentOn, data.from))
    if (data.to) conditions.push(lte(expense.spentOn, data.to))
    if (data.categoryIds && data.categoryIds.length > 0) {
      conditions.push(inArray(expense.categoryId, data.categoryIds))
    }
    if (data.memberId) {
      // "paid by" or "shared with" — a member filter should not hide an expense
      // they are part of the split for.
      conditions.push(
        sql`(${expense.paidByMemberId} = ${data.memberId} or exists (
              select 1 from ${expenseSplit}
              where ${expenseSplit.expenseId} = ${expense.id}
                and ${expenseSplit.memberId} = ${data.memberId}
            ))`,
      )
    }

    const rows = await db
      .select(expenseSelect())
      .from(expense)
      .leftJoin(category, eq(expense.categoryId, category.id))
      .innerJoin(spaceMember, eq(expense.paidByMemberId, spaceMember.id))
      .where(and(...conditions))
      .orderBy(desc(expense.spentOn), desc(expense.createdAt))
      .limit(data.limit)

    const splitMap = await splitsFor(
      data.spaceId,
      rows.map((r) => r.id),
    )

    return rows.map<ExpenseRow>((r) => ({
      ...r,
      // Drizzle's `date()` mode already yields a 'YYYY-MM-DD' string.
      spentOn: r.spentOn,
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      splits: splitMap.get(r.id) ?? [],
    }))
  })

export interface CategoryTotal {
  id: string
  name: string
  color: string
  icon: string
  totalMinor: number
  count: number
}

export interface TotalsResult {
  totalMinor: number
  count: number
  yourShareMinor: number
  byCategory: Array<CategoryTotal>
}

/**
 * Totals for the whole ledger, or for an arbitrary selection of categories.
 * The checkbox filter is the "sum these specific categories" function: the
 * selected ids go into the query, so headline, chart and list all move
 * together in one pass.
 */
export const getTotals = createServerFn({ method: 'GET' })
  .inputValidator(periodFilterSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession()
    const member = await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const conditions = [eq(expense.spaceId, data.spaceId)]
    if (data.from) conditions.push(gte(expense.spentOn, data.from))
    if (data.to) conditions.push(lte(expense.spentOn, data.to))
    if (data.categoryIds && data.categoryIds.length > 0) {
      conditions.push(inArray(expense.categoryId, data.categoryIds))
    }

    const byCategory = await db
      .select({
        id: category.id,
        name: category.name,
        color: category.color,
        icon: category.icon,
        totalMinor: sql<number>`coalesce(sum(${expense.amountMinor}), 0)::int`,
        count: sql<number>`count(${expense.id})::int`,
      })
      .from(category)
      .leftJoin(
        expense,
        and(
          eq(expense.categoryId, category.id),
          data.from ? gte(expense.spentOn, data.from) : undefined,
          data.to ? lte(expense.spentOn, data.to) : undefined,
          data.categoryIds && data.categoryIds.length > 0
            ? inArray(expense.categoryId, data.categoryIds)
            : undefined,
        ),
      )
      .where(and(eq(category.spaceId, data.spaceId), isNull(category.archivedAt)))
      .groupBy(category.id, category.name, category.color, category.icon)
      .orderBy(desc(sql`coalesce(sum(${expense.amountMinor}), 0)`))

    const totalMinor = byCategory.reduce((s, c) => s + c.totalMinor, 0)
    const count = byCategory.reduce((s, c) => s + c.count, 0)

    // "Your share" = your portion of the filtered expenses, read from the
    // stored share_minor rather than recomputed from weights.
    const [share] = await db
      .select({ total: sql<number>`coalesce(sum(${expenseSplit.shareMinor}), 0)::int` })
      .from(expenseSplit)
      .innerJoin(expense, eq(expenseSplit.expenseId, expense.id))
      .where(
        and(
          eq(expenseSplit.memberId, member.id),
          ...conditions,
        ),
      )

    return {
      totalMinor,
      count,
      yourShareMinor: Number(share?.total ?? 0),
      byCategory: byCategory.map((c) => ({
        ...c,
        totalMinor: Number(c.totalMinor),
        count: Number(c.count),
      })),
    } satisfies TotalsResult
  })

export interface MemberBalance {
  memberId: string
  displayName: string
  color: string
  userId: string | null
  paidMinor: number
  shareMinor: number
  netMinor: number
}

export type { Settlement } from './settle'

export interface BalancesResult {
  balances: Array<MemberBalance>
  settlements: Array<Settlement>
  yourNetMinor: number
  yourMemberId: string
}

/**
 * Per-member balance over a range, plus a minimal settlement plan.
 *
 * net = paid − share. Positive means the household owes them.
 */
export const getBalances = createServerFn({ method: 'GET' })
  .inputValidator(periodFilterSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession()
    const me = await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const conditions = [eq(expense.spaceId, data.spaceId)]
    if (data.from) conditions.push(gte(expense.spentOn, data.from))
    if (data.to) conditions.push(lte(expense.spentOn, data.to))
    if (data.categoryIds && data.categoryIds.length > 0) {
      conditions.push(inArray(expense.categoryId, data.categoryIds))
    }

    const rows = await db
      .select({
        memberId: spaceMember.id,
        displayName: spaceMember.displayName,
        color: spaceMember.color,
        userId: spaceMember.userId,
        paidMinor: sql<number>`coalesce(sum(${expense.amountMinor}) filter (where ${expense.paidByMemberId} = ${spaceMember.id}), 0)::int`,
        shareMinor: sql<number>`coalesce(sum(${expenseSplit.shareMinor}), 0)::int`,
      })
      .from(spaceMember)
      .leftJoin(
        expenseSplit,
        and(
          eq(expenseSplit.memberId, spaceMember.id),
          // `exists` correlates on the expense, so the date range is applied
          // per split row rather than widening the join.
          sql`exists (
            select 1 from ${expense}
            where ${expense.id} = ${expenseSplit.expenseId}
              ${data.from ? sql`and ${expense.spentOn} >= ${data.from}` : sql``}
              ${data.to ? sql`and ${expense.spentOn} <= ${data.to}` : sql``}
              ${data.categoryIds && data.categoryIds.length > 0 ? sql`and ${expense.categoryId} in ${data.categoryIds}` : sql``}
          )`,
        ),
      )
      .where(and(eq(spaceMember.spaceId, data.spaceId), isNull(spaceMember.archivedAt)))
      .groupBy(spaceMember.id, spaceMember.displayName, spaceMember.color, spaceMember.userId)

    const balances: Array<MemberBalance> = rows.map((r) => {
      const paid = Number(r.paidMinor)
      const share = Number(r.shareMinor)
      return {
        memberId: r.memberId,
        displayName: r.displayName,
        color: r.color,
        userId: r.userId,
        paidMinor: paid,
        shareMinor: share,
        netMinor: paid - share,
      }
    })

    // Total of the nets must be zero. If it is not, some share rows are
    // outside the filter and the settlement plan would be wrong; surface it
    // rather than settling a phantom amount.
    const netSum = balances.reduce((s, b) => s + b.netMinor, 0)
    if (netSum !== 0) {
      console.warn(
        `[balances] net does not balance (${netSum} minor units) for space ${data.spaceId}`,
      )
    }

    return {
      balances,
      settlements: settle(balances),
      yourNetMinor: balances.find((b) => b.memberId === me.id)?.netMinor ?? 0,
      yourMemberId: me.id,
    } satisfies BalancesResult
  })


