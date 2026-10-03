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
import {
  category,
  expense,
  expenseSplit,
  space,
  spaceMember,
  user,
} from './db/schema'
import {
  expenseInputSchema,
  isoDateSchema,
  periodFilterSchema,
  uuidSchema,
} from './guards'
import { BP_TOTAL, allocate, parseAmountToMinor } from './money'
import { settle } from './settle'
import { displayMemberName } from './member-name'
import type { Db } from './db'
import type { SQL } from 'drizzle-orm'
import type { Settlement } from './settle'

/**
 * Category filter with three distinct states.
 *
 *   undefined → no filter, every category
 *   []        → an explicit empty selection: match nothing
 *   [ids]     → match these
 *
 * Collapsing `[]` into "no filter" is a real bug, not a nitpick: the dashboard
 * has a "None" button, and a user who deselects everything should see a zero
 * total, not the whole ledger. `inArray(col, [])` is not usable for the middle
 * case, hence the explicit `false`.
 */
function categoryFilter(
  categoryIds: Array<string> | undefined,
): SQL | undefined {
  if (categoryIds === undefined) return undefined
  if (categoryIds.length === 0) return sql`false`
  return inArray(expense.categoryId, categoryIds)
}

export interface SplitRow {
  memberId: string
  /** Carries the `(removed)` suffix when the member has left. */
  displayName: string
  color: string
  archivedAt: Date | null
  /** Their account avatar, or null — then the caller derives one from memberId. */
  avatar: string | null
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
  /** When the payer left the household, if they have. */
  paidByArchivedAt: Date | null
  /** The payer's account avatar, or null — then derive one from paidByMemberId. */
  paidByAvatar: string | null
  createdByUserId: string | null
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
    paidByArchivedAt: spaceMember.archivedAt,
    // The payer's account avatar, so a list of expenses shows faces rather than
    // a column of names. Null for a virtual payer, who then gets an identicon
    // derived from the member id.
    paidByAvatar: user.avatar,
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
      archivedAt: spaceMember.archivedAt,
      avatar: user.avatar,
      weightBp: expenseSplit.weightBp,
      shareMinor: expenseSplit.shareMinor,
    })
    .from(expenseSplit)
    .innerJoin(spaceMember, eq(expenseSplit.memberId, spaceMember.id))
    .leftJoin(user, eq(spaceMember.userId, user.id))
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
      // Marked here rather than at each render site: a removed member has to
      // read as removed in the split summary, the balance table and the export
      // alike, and the suffix is a fact about the row rather than a presentation
      // choice made per screen.
      displayName: displayMemberName(r.displayName, r.archivedAt),
      color: r.color,
      archivedAt: r.archivedAt,
      avatar: r.avatar,
      weightBp: r.weightBp,
      shareMinor: r.shareMinor,
    }
    if (list) list.push(entry)
    else byExpense.set(r.expenseId, [entry])
  }
  return byExpense
}

// ── writes ────────────────────────────────────────────────────────────────

/**
 * Throw unless every given member row belongs to `spaceId`.
 *
 * The database cannot enforce this: `expense_split.member_id` references
 * `space_member.id`, and nothing in the schema connects that member to the
 * expense's own space. So the check is the application's job, and it has to
 * happen on *every* path that writes a member reference — which is the whole
 * point of having it in one function.
 *
 * What the gap looked like when it was only checked on create: `updateExpense`
 * took `paidByMemberId` and `splits[].memberId` straight from the client, so a
 * member of any household could name a member of *another* one and invent a debt
 * for them. Confirmed against a real Postgres — the insert succeeded and the
 * victim's balance query reported the fabricated share. The database said yes
 * because the constraint it was given does not mention spaces.
 *
 * `label` distinguishes the payer from a split participant in the message. Both
 * are rejections of the same kind, but "Payer is not a member of this household"
 * is the one that tells somebody what to fix.
 */
async function assertMembersInSpace(
  db: Db,
  spaceId: string,
  memberIds: ReadonlyArray<string>,
  label = 'Split participant',
) {
  const ids = [...new Set(memberIds)]
  if (ids.length === 0) return

  const found = await db
    .select({ id: spaceMember.id })
    .from(spaceMember)
    .where(and(eq(spaceMember.spaceId, spaceId), inArray(spaceMember.id, ids)))
  const known = new Set(found.map((f) => f.id))

  const stranger = ids.find((id) => !known.has(id))
  if (stranger) {
    throw new Error(`${label} is not a member of this space`)
  }
}

/**
 * Whether this caller may change an expense they did not enter.
 *
 * Three ways to pass, in order:
 *
 *   1. You entered it. Always yours to correct — a typo in your own entry is
 *      yours to fix and nobody else's to be protected from.
 *   2. You own the household. An owner who cannot fix a bad entry is an owner
 *      with a broken household, and they already have strictly larger powers
 *      (deleting it, archiving whoever entered it).
 *   3. The household has opened its ledger to each other.
 *
 * Otherwise: no. A shared ledger where any member can rewrite anyone else's
 * entries is one where nobody can trust what they are shown they spent, and the
 * household setting exists so a group that *wants* to work that way can say so
 * once instead of every row carrying its own permission.
 *
 * Throws rather than returning a boolean, because every caller here is a write
 * and there is nothing to do with a false.
 *
 * `createdByUserId` is read from the row rather than passed in: it is the one
 * value the client must not be able to influence.
 */
async function assertMayEdit(
  db: Db,
  userId: string,
  spaceId: string,
  existing: { createdByUserId: string | null },
) {
  if (existing.createdByUserId === userId) return

  const [household] = await db
    .select({
      editableByMembers: space.editableByMembers,
      role: spaceMember.role,
    })
    .from(space)
    .innerJoin(
      spaceMember,
      and(
        eq(spaceMember.spaceId, space.id),
        eq(spaceMember.userId, userId),
        isNull(spaceMember.archivedAt),
      ),
    )
    .where(eq(space.id, spaceId))
    .limit(1)

  if (!household) throw new Error('Not found')
  if (household.role === 'owner' || household.editableByMembers) return

  throw new Error('This expense was added by someone else')
}

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

    // Every split participant must belong to this space. Checked after the
    // weight and duplicate checks so the message names the actual problem.
    await assertMembersInSpace(
      db,
      data.spaceId,
      splits.map((s) => s.memberId),
    )

    const shares = allocate(
      amountMinor,
      splits.map((s) => s.weightBp),
    )

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
        .select({
          total: sql<number>`coalesce(sum(${expenseSplit.shareMinor}), 0)::int`,
        })
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
      .where(
        and(eq(expense.id, data.expenseId), eq(expense.spaceId, data.spaceId)),
      )
      .limit(1)
    if (!existing) throw new Error('Not found')

    await assertMayEdit(db, session.user.id, data.spaceId, existing)

    const amountMinor =
      data.amount !== undefined
        ? parseAmountToMinor(data.amount)
        : existing.amountMinor
    const paidByMemberId = data.paidByMemberId ?? existing.paidByMemberId

    /**
     * Both of these reference a member row, and the database will happily write
     * one belonging to another household — see assertMembersInSpace. This was
     * the one write path in the app with no such check, which made it possible
     * to invent a debt in somebody else's ledger by editing an expense of your
     * own.
     *
     * The payer is validated whenever the client sends one, not only when it
     * changes: the check has to cover the value that is actually written, and
     * an expense can already carry a stale reference from before this existed.
     * Archived members are allowed, because `paid_by_member_id` is restrict and
     * archiving somebody must not make their old expenses uneditable.
     */
    await assertMembersInSpace(db, data.spaceId, [paidByMemberId], 'Payer')

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

    if (data.spentOn !== undefined) {
      // Deliberately lax in the schema here and strict here. `z.string().trim()`
      // accepts "next tuesday", and Postgres rejects it — but as an unhandled
      // 500 with the SQL error attached, rather than as a field-level message.
      const parsedDate = isoDateSchema.safeParse(data.spentOn)
      if (!parsedDate.success) {
        throw new Error('That is not a real date')
      }
    }

    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(expense)
        .set({
          amountMinor,
          categoryId:
            data.categoryId !== undefined
              ? data.categoryId
              : existing.categoryId,
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
        // An empty array means "no split — the payer takes all of it", and it is
        // deliberately allowed. This used to throw, which meant turning the
        // split toggle off while editing an expense failed with "send at least
        // one split": the sheet sends `[]` to mean exactly this, and the server
        // could not tell it from a mistake. Omitting the key still means "leave
        // the splits alone", so the three cases stay distinct.
        // Everything below this guard is about validating a split that exists.
        // With none there is nothing to total, nothing to deduplicate and
        // nothing to allocate — the delete-and-reinsert below still runs, and
        // removing every row is the whole point of `[]`.
        if (splits.length > 0) {
          const weightSum = splits.reduce((s, r) => s + r.weightBp, 0)
          if (weightSum !== BP_TOTAL) {
            throw new Error(
              `Split weights must total 100%, got ${weightSum / 100}%`,
            )
          }

          const seen = new Set<string>()
          for (const s of splits) {
            if (seen.has(s.memberId)) {
              throw new Error('Duplicate member in split')
            }
            seen.add(s.memberId)
          }

          // The same cross-household check the create path does. Without it this
          // is a write of expense_split rows naming strangers, which is the
          // whole of the vulnerability.
          await assertMembersInSpace(
            db,
            data.spaceId,
            splits.map((s) => s.memberId),
          )
        }

        const shares =
          splits.length > 0
            ? allocate(
                amountMinor,
                splits.map((s) => s.weightBp),
              )
            : []

        await tx
          .delete(expenseSplit)
          .where(eq(expenseSplit.expenseId, data.expenseId))
        // `values([])` is a no-op on some drivers and an error on others, and
        // there is nothing to write anyway.
        if (splits.length > 0) {
          await tx.insert(expenseSplit).values(
            splits.map((s, i) => ({
              expenseId: data.expenseId,
              memberId: s.memberId,
              weightBp: s.weightBp,
              shareMinor: shares[i]!,
            })),
          )
        }

        // Only meaningful when there ARE splits. With none, the payer's implied
        // share is the whole amount — which is how the balances query has always
        // treated a split-less expense — so there is no row to sum against and
        // comparing 0 to the amount would fail every legitimate un-split.
        if (splits.length > 0) {
          const [check] = await tx
            .select({
              total: sql<number>`coalesce(sum(${expenseSplit.shareMinor}), 0)::int`,
            })
            .from(expenseSplit)
            .where(eq(expenseSplit.expenseId, data.expenseId))
          if (Number(check?.total ?? 0) !== amountMinor) {
            throw new Error('Split invariant violated on update')
          }
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

    /**
     * The same rule as editing, and it has to be: being unable to change what
     * somebody entered is worth little if you can delete it outright. Deleting
     * is strictly more destructive, so it is not the one operation that skips
     * the check.
     */
    const [existing] = await db
      .select({ createdByUserId: expense.createdByUserId })
      .from(expense)
      .where(
        and(eq(expense.id, data.expenseId), eq(expense.spaceId, data.spaceId)),
      )
      .limit(1)
    if (!existing) throw new Error('Not found')
    await assertMayEdit(db, session.user.id, data.spaceId, existing)

    // expense_split rows cascade; scoping the delete by spaceId stops a
    // guessed id from removing another space's expense.
    const deleted = await db
      .delete(expense)
      .where(
        and(eq(expense.id, data.expenseId), eq(expense.spaceId, data.spaceId)),
      )
      .returning({ id: expense.id })

    if (deleted.length === 0) throw new Error('Not found')
    return { ok: true }
  })

// ── reads ─────────────────────────────────────────────────────────────────

export const listExpenses = createServerFn({ method: 'GET' })
  .inputValidator(
    periodFilterSchema.extend({
      limit: z.number().int().min(1).max(500).default(200),
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    // Typed to allow undefined: drizzle's and() drops undefined entries, which
    // is how an absent bound is expressed.
    const conditions: Array<SQL | undefined> = [
      eq(expense.spaceId, data.spaceId),
    ]
    if (data.from) conditions.push(gte(expense.spentOn, data.from))
    if (data.to) conditions.push(lte(expense.spentOn, data.to))
    conditions.push(categoryFilter(data.categoryIds))
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
      // For the payer's avatar, so a list of expenses shows faces rather than a
      // column of names. Left, not inner: a virtual payer has no account row, and
      // an inner join here would drop every expense they paid.
      .leftJoin(user, eq(spaceMember.userId, user.id))
      .where(and(...conditions))
      .orderBy(desc(expense.spentOn), desc(expense.createdAt))
      .limit(data.limit)

    const splitMap = await splitsFor(
      data.spaceId,
      rows.map((r) => r.id),
    )

    return rows.map<ExpenseRow>((r) => ({
      ...r,
      paidByName: displayMemberName(r.paidByName, r.paidByArchivedAt),
      // Drizzle's `date()` mode already yields a 'YYYY-MM-DD' string.
      spentOn: r.spentOn,
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt),
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

    // Typed to allow undefined: drizzle's and() drops undefined entries, which
    // is how an absent bound is expressed.
    const conditions: Array<SQL | undefined> = [
      eq(expense.spaceId, data.spaceId),
    ]
    if (data.from) conditions.push(gte(expense.spentOn, data.from))
    if (data.to) conditions.push(lte(expense.spentOn, data.to))
    conditions.push(categoryFilter(data.categoryIds))

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
          categoryFilter(data.categoryIds),
        ),
      )
      .where(
        and(eq(category.spaceId, data.spaceId), isNull(category.archivedAt)),
      )
      .groupBy(category.id, category.name, category.color, category.icon)
      .orderBy(desc(sql`coalesce(sum(${expense.amountMinor}), 0)`))

    const totalMinor = byCategory.reduce((s, c) => s + c.totalMinor, 0)
    const count = byCategory.reduce((s, c) => s + c.count, 0)

    // "Your share" = your portion of the filtered expenses, read from the
    // stored share_minor rather than recomputed from weights.
    const [share] = await db
      .select({
        total: sql<number>`coalesce(sum(${expenseSplit.shareMinor}), 0)::int`,
      })
      .from(expenseSplit)
      .innerJoin(expense, eq(expenseSplit.expenseId, expense.id))
      .where(and(eq(expenseSplit.memberId, member.id), ...conditions))

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
  /** Their account avatar, or null — then the caller derives one from memberId. */
  avatar: string | null
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

    // Typed to allow undefined: drizzle's and() drops undefined entries, which
    // is how an absent bound is expressed.
    const conditions: Array<SQL | undefined> = [
      eq(expense.spaceId, data.spaceId),
    ]
    if (data.from) conditions.push(gte(expense.spentOn, data.from))
    if (data.to) conditions.push(lte(expense.spentOn, data.to))
    conditions.push(categoryFilter(data.categoryIds))

    // Join conditions for the expense, built as a list. An empty `sql`
    // fragment inside `and()` renders as nothing and leaves a dangling "and",
    // which is a syntax error — and "All time" (no bounds at all) is the
    // default period, so this path must work with zero conditions.
    const expenseJoin = [eq(expense.id, expenseSplit.expenseId)]
    if (data.from) expenseJoin.push(sql`${expense.spentOn} >= ${data.from}`)
    if (data.to) expenseJoin.push(sql`${expense.spentOn} <= ${data.to}`)
    if (data.categoryIds !== undefined) {
      expenseJoin.push(categoryFilter(data.categoryIds)!)
    }

    const rows = await db
      .select({
        memberId: spaceMember.id,
        displayName: spaceMember.displayName,
        color: spaceMember.color,
        userId: spaceMember.userId,
        avatar: user.avatar,
        paidMinor: sql<number>`coalesce(
          sum(${expense.amountMinor}) filter (where ${expense.paidByMemberId} = ${spaceMember.id}),
          0
        )::int`,
        // `e.id is not null` is load-bearing. The split row joins regardless of
        // the range, so without it an out-of-period split would still be
        // counted and a period with no expenses would report the full
        // all-time balance.
        shareMinor: sql<number>`coalesce(
          sum(${expenseSplit.shareMinor}) filter (where ${expense.id} is not null),
          0
        )::int`,
      })
      .from(spaceMember)
      .leftJoin(user, eq(spaceMember.userId, user.id))
      .leftJoin(expenseSplit, eq(expenseSplit.memberId, spaceMember.id))
      .leftJoin(expense, and(...expenseJoin))
      .where(
        and(
          eq(spaceMember.spaceId, data.spaceId),
          isNull(spaceMember.archivedAt),
        ),
      )
      .groupBy(
        spaceMember.id,
        spaceMember.displayName,
        spaceMember.color,
        spaceMember.userId,
        // Postgres requires every selected column to be grouped or aggregated, and
        // the avatar is selected. It is functionally dependent on space_member.id
        // but only because it is the primary key, and relying on that is not
        // portable — so it is grouped like the rest.
        user.avatar,
      )

    const balances: Array<MemberBalance> = rows.map((r) => {
      const paid = Number(r.paidMinor)
      const share = Number(r.shareMinor)
      return {
        memberId: r.memberId,
        displayName: r.displayName,
        color: r.color,
        userId: r.userId,
        avatar: r.avatar,
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
