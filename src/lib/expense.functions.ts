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
import {
  and,
  asc,
  desc,
  count as drizzleCount,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import { ensureSession, requireSpaceMember } from './auth.functions'
import { getDb } from './db'
import {
  category,
  expense,
  expenseNote,
  expenseSplit,
  recurringExpense,
  recurringExpenseSplit,
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
import { anchorDayOf, nextOccurrence, periodKey } from './recurrence'
import { materialiseRecurring } from './recurring.functions'
import { applySettlements, settle } from './settle'
import { loadSettlements } from './settlement.functions'
import { displayMemberName } from './member-name'
import { mayDeleteExpenseNote } from './may-edit'
import { UNCATEGORISED_ID } from './uncategorised'
import type { RecordedSettlement } from './settlement.functions'
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
 *
 * `[UNCATEGORISED_ID]` (or alongside real ids) matches entries with no category.
 * Null cannot travel in `cats=a,b` or in `inArray()`, so the pseudo-id is
 * translated back to `IS NULL` here — the one place that translation lives, so
 * every screen using this helper agrees on what it means. It is stripped before
 * `inArray()` for a reason beyond tidiness: comparing a uuid column to a
 * non-uuid string is a Postgres error, not an empty result.
 */
function categoryFilter(
  categoryIds: Array<string> | undefined,
): SQL | undefined {
  if (categoryIds === undefined) return undefined
  const rest = categoryIds.filter((id) => id !== UNCATEGORISED_ID)
  const uncat = categoryIds.includes(UNCATEGORISED_ID)
  if (rest.length === 0) return uncat ? isNull(expense.categoryId) : sql`false`
  const known = inArray(expense.categoryId, rest)
  return uncat ? or(known, isNull(expense.categoryId)) : known
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
  /**
   * Whether the author locked this entry against edits by anyone else. The
   * author's own edit rights are unaffected.
   */
  locked: boolean
  createdByUserId: string | null
  /** Whoever typed it in, or null once their account is gone. */
  createdByName: string | null
  createdByAvatar: string | null
  createdAt: string
  splits: Array<SplitRow>
  /** How many notes are attached, for the list's marker. Not the notes. */
  noteCount: number
  /**
   * The repeating series this entry came from, if it did. `frequency` and
   * `archivedAt` describe that series: a stopped one is no longer repeating, so
   * the list says nothing about it and the entry reads as a plain expense.
   */
  recurringId: string | null
  recurringFrequency: 'monthly' | 'weekly' | null
  recurringArchivedAt: Date | null
}

export interface NoteRow {
  id: string
  expenseId: string
  body: string
  /**
   * A snapshot of the name at the time, so a note outlives the account that
   * wrote it. Never null — unlike `authorUserId`, which is.
   */
  authorName: string
  /** Null once the author's account is deleted; then the name carries it alone. */
  authorAvatar: string | null
  /** Who left it, for the delete control. Null once their account is gone. */
  authorUserId: string | null
  /** False for a note whose author has deleted their account. */
  authorActive: boolean
  createdAt: string
}

/** Shared SELECT: expenses joined to their category and payer. */
function expenseSelect() {
  return {
    id: expense.id,
    spaceId: expense.spaceId,
    amountMinor: expense.amountMinor,
    spentOn: expense.spentOn,
    purpose: expense.purpose,
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
    locked: expense.locked,
    createdByUserId: expense.createdByUserId,
    // Who typed it in, by name — not just by id. "Entered by Alex" is what makes
    // a read-only expense legible; an id says nothing to the person looking at
    // it. Left-joined like the payer's avatar, because deleting an account nulls
    // the id and the entry must still render.
    createdByName: author.name,
    createdByAvatar: author.avatar,
    createdAt: expense.createdAt,
    /**
     * The series this entry belongs to, for the "Repeats monthly" marker.
     *
     * The frequency and the series' archived state come along with it, because
     * the marker has to distinguish three cases and an id alone cannot: no series
     * at all, a live series (repeats), and a stopped one, which is a plain entry
     * from here on and should say nothing.
     */
    recurringId: expense.recurringId,
    recurringFrequency: recurringExpense.frequency,
    recurringArchivedAt: recurringExpense.archivedAt,
  }
}

/**
 * `user` twice in one query: once as the payer, once as whoever entered the
 * entry. Drizzle needs distinct table handles for that, and a second alias with
 * no name would collide with the first in the generated SQL.
 */
const author = alias(user, 'expense_author')

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
 * One rule: the author decides.
 *
 *   - You entered it. Always yours to correct — a typo in your own entry is
 *     yours to fix and nobody else's to be protected from, and a locked entry
 *     does not lock its author out of it.
 *   - You did not, and they locked it. No.
 *   - You did not, and they did not. Yes.
 *
 * The household-wide switch this replaced had to be set to the most cautious
 * value anybody in the household ever wanted, which made it useless for every
 * entry that did not need it. The owner override, likewise, made the author's
 * lock a suggestion — the person it is about could not be the one to overrule it.
 * Both are gone, and `mayEditExpense` in ./may-edit is the same rule for the UI.
 *
 * Throws rather than returning a boolean, because every caller here is a write
 * and there is nothing to do with a false.
 *
 * `createdByUserId` is read from the row rather than passed in: it is the one
 * value the client must not be able to influence. Note that this function is
 * pure now — the lock is on the row the caller already selected, so the space and
 * role lookup it used to do is not merely redundant, it is gone.
 */
function assertMayEdit(
  existing: { createdByUserId: string | null; locked: boolean },
  userId: string,
) {
  if (existing.createdByUserId === userId) return
  if (existing.locked) {
    throw new Error('This expense was added by someone else')
  }
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
      /**
       * The series, when this entry starts one.
       *
       * Created inside the same transaction as the expense it came from, and the
       * expense is the series' first occurrence rather than a separate seed row.
       * The alternative — commit the expense, then create the series, then link
       * them — has a window where a rent exists that repeats nothing, and the
       * user's next action is to wonder why.
       *
       * `spentOn` is the anchor. The series repeats on the day of the month the
       * first one was dated, so "rent, the 1st" is set up by dating it the 1st,
       * which is how somebody would say it out loud anyway.
       */
      // Narrowed once, here, so the series code below is not written inside a
      // condition that TypeScript has to re-derive at every use.
      const frequency = data.repeat === 'never' ? null : data.repeat

      const series =
        frequency === null
          ? null
          : (
              await tx
                .insert(recurringExpense)
                .values({
                  spaceId: data.spaceId,
                  purpose: data.purpose,
                  amountMinor,
                  categoryId: data.categoryId,
                  paidByMemberId: data.paidByMemberId,
                  frequency,
                  anchorDay: anchorDayOf(data.spentOn),
                  startsOn: data.spentOn,
                  nextDueOn: nextOccurrence(
                    data.spentOn,
                    frequency,
                    anchorDayOf(data.spentOn),
                  ),
                  locked: data.locked,
                  createdByUserId: session.user.id,
                })
                .returning({ id: recurringExpense.id })
            )[0]!

      const [row] = await tx
        .insert(expense)
        .values({
          spaceId: data.spaceId,
          categoryId: data.categoryId,
          paidByMemberId: data.paidByMemberId,
          spentOn: data.spentOn,
          purpose: data.purpose,
          amountMinor,
          locked: data.locked,
          createdByUserId: session.user.id,
          recurringId: series?.id ?? null,
          // The first occurrence's key, so materialisation on a later read
          // recognises this month as already done instead of making a second rent.
          periodKey: frequency ? periodKey(frequency, data.spentOn) : null,
        })
        .returning()
      if (!row) throw new Error('Failed to create expense')

      if (series) {
        await tx.insert(recurringExpenseSplit).values(
          splits.map((s) => ({
            recurringId: series.id,
            memberId: s.memberId,
            weightBp: s.weightBp,
          })),
        )
      }

      // The sheet's note field, written as the first note rather than as a
      // column. Same transaction as the expense, so an entry never exists
      // without the remark that came with it — the alternative is a note whose
      // author is guessing whether it saved.
      if (data.note?.trim()) {
        await tx.insert(expenseNote).values({
          spaceId: data.spaceId,
          expenseId: row.id,
          body: data.note.trim(),
          authorUserId: session.user.id,
          authorName: session.user.name,
        })
      }

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

    assertMayEdit(existing, session.user.id)

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
      .select({
        createdByUserId: expense.createdByUserId,
        locked: expense.locked,
      })
      .from(expense)
      .where(
        and(eq(expense.id, data.expenseId), eq(expense.spaceId, data.spaceId)),
      )
      .limit(1)
    if (!existing) throw new Error('Not found')
    assertMayEdit(existing, session.user.id)

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

/**
 * Lock or unlock one entry. The author only.
 *
 * Its own function rather than a field on `updateExpense`, because the rule is
 * not the rule for everything else in the entry: anybody who may edit an expense
 * can change its amount, and only the person who entered it can decide whether
 * the rest of the household may. Folding it into the update payload would have
 * made the second rule reachable by the first one's callers — the household
 * setting is gone precisely so that "may edit" and "may grant editing" are not
 * the same permission.
 *
 * Locking is therefore checked against `createdByUserId` and nothing else. Not
 * the owner, not an editor: the person it is about does not get to overrule it.
 * The cost of that is stated on the column and it is a real one — a locked entry
 * whose author leaves the household can never be fixed by anybody — but the
 * alternative is a lock that means "unless".
 */
export const setExpenseLock = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      spaceId: uuidSchema,
      expenseId: uuidSchema,
      locked: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const [existing] = await db
      .select({
        createdByUserId: expense.createdByUserId,
        locked: expense.locked,
      })
      .from(expense)
      .where(
        and(eq(expense.id, data.expenseId), eq(expense.spaceId, data.spaceId)),
      )
      .limit(1)
    if (!existing) throw new Error('Not found')

    if (existing.createdByUserId !== session.user.id) {
      throw new Error('Only the person who added this can lock it')
    }
    if (existing.locked === data.locked) return { locked: existing.locked }

    const [row] = await db
      .update(expense)
      .set({ locked: data.locked })
      .where(
        and(eq(expense.id, data.expenseId), eq(expense.spaceId, data.spaceId)),
      )
      .returning({ locked: expense.locked })

    if (!row) throw new Error('Not found')
    return { locked: row.locked }
  })

// ── notes ─────────────────────────────────────────────────────────────────

/**
 * Leave a note on an expense.
 *
 * Membership is the only requirement. `requireSpaceMember` and nothing else —
 * deliberately *not* `assertMayEdit`, because a note is not an edit: it changes
 * nothing about the amount, the split, or who paid. Someone who cannot touch
 * this expense is precisely the person who most needs to be able to write "this
 * was the deposit, not the full rent" underneath it, and a household where that
 * is impossible is a household that argues in the room instead.
 *
 * `authorName` is written here, from the session, rather than joined at read
 * time: it is a snapshot, so a note still says who left it after that person has
 * deleted their account. See the column for why that is the app's rule.
 */
export const addExpenseNote = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      spaceId: uuidSchema,
      expenseId: uuidSchema,
      // Trimmed by the schema, so a note of pure whitespace is rejected as a
      // validation error naming the field rather than as a constraint violation.
      // The column refuses it too, for writes that did not come through here.
      body: z
        .string()
        .trim()
        .min(1, 'Write something first')
        .max(2000, 'That is longer than a note'),
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    // Scoped by space as well as by id, so a note cannot be attached to another
    // household's expense by guessing its id.
    const [target] = await db
      .select({ id: expense.id })
      .from(expense)
      .where(
        and(eq(expense.id, data.expenseId), eq(expense.spaceId, data.spaceId)),
      )
      .limit(1)
    if (!target) throw new Error('Not found')

    const [row] = await db
      .insert(expenseNote)
      .values({
        spaceId: data.spaceId,
        expenseId: data.expenseId,
        body: data.body,
        authorUserId: session.user.id,
        authorName: session.user.name,
      })
      .returning({
        id: expenseNote.id,
        expenseId: expenseNote.expenseId,
        body: expenseNote.body,
        authorName: expenseNote.authorName,
        createdAt: expenseNote.createdAt,
      })
    if (!row) throw new Error('Could not save the note')

    return {
      ...row,
      authorAvatar: session.user.avatar ?? null,
      // The author of a note they just wrote is by definition still here.
      authorActive: true,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
    }
  })

/**
 * The notes on one expense, oldest first.
 *
 * Oldest first because that is the order they were left in, and a conversation
 * read backwards is not a conversation. `spaceId` is part of the WHERE clause
 * rather than trusted from the caller, so a guessed expense id from another
 * household returns nothing instead of somebody else's notes.
 */
export const listExpenseNotes = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ spaceId: uuidSchema, expenseId: uuidSchema }))
  .handler(async ({ data }): Promise<Array<NoteRow>> => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const rows = await db
      .select({
        id: expenseNote.id,
        expenseId: expenseNote.expenseId,
        body: expenseNote.body,
        authorName: expenseNote.authorName,
        authorAvatar: user.avatar,
        authorUserId: expenseNote.authorUserId,
        createdAt: expenseNote.createdAt,
      })
      .from(expenseNote)
      // Left, not inner: a deleted author must not take their note with them.
      .leftJoin(user, eq(expenseNote.authorUserId, user.id))
      .where(
        and(
          eq(expenseNote.expenseId, data.expenseId),
          eq(expenseNote.spaceId, data.spaceId),
        ),
      )
      .orderBy(asc(expenseNote.createdAt), asc(expenseNote.id))

    return rows.map((r) => ({
      id: r.id,
      expenseId: r.expenseId,
      body: r.body,
      authorName: r.authorName,
      authorAvatar: r.authorAvatar,
      authorUserId: r.authorUserId,
      // The account's existence, not the avatar's: plenty of people never pick
      // one, and the identicon fallback covers them. Reading "no avatar" as
      // "account deleted" would mark half the notes as written by ghosts.
      authorActive: r.authorUserId !== null,
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt),
    }))
  })

/**
 * Remove one note.
 *
 * Two people may: whoever left it, and whoever entered the expense it hangs
 * under. The first is obvious — your own remark is yours to take back. The
 * second is the price of the wall being yours: an entry whose notes its author
 * cannot moderate collects whatever anyone writes under it, and nobody would
 * leave their entries open to that. Note the asymmetry with editing, which the
 * expense author cannot grant: removing a remark *about* an entry is not
 * changing the entry, and the entry's author stays responsible for what stands
 * under their name.
 *
 * A note whose author deleted their account has `authorUserId` null, so the
 * first rule can never fire for it — only the expense author can clear those,
 * which is also the only way they ever get cleared.
 */
export const deleteExpenseNote = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      spaceId: uuidSchema,
      expenseId: uuidSchema,
      noteId: uuidSchema,
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    // Scoped three ways — note, expense and space — so a guessed id from
    // another household matches nothing instead of somebody else's remark.
    const [note] = await db
      .select({
        id: expenseNote.id,
        authorUserId: expenseNote.authorUserId,
        createdByUserId: expense.createdByUserId,
      })
      .from(expenseNote)
      .innerJoin(expense, eq(expenseNote.expenseId, expense.id))
      .where(
        and(
          eq(expenseNote.id, data.noteId),
          eq(expenseNote.expenseId, data.expenseId),
          eq(expenseNote.spaceId, data.spaceId),
          eq(expense.spaceId, data.spaceId),
        ),
      )
      .limit(1)
    if (!note) throw new Error('Not found')

    if (
      !mayDeleteExpenseNote(
        { authorUserId: note.authorUserId },
        { createdByUserId: note.createdByUserId },
        session.user.id,
      )
    ) {
      throw new Error('Only the person who left it can remove it')
    }

    await db.delete(expenseNote).where(eq(expenseNote.id, data.noteId))
    return { ok: true }
  })

/**
 * How many notes each of these expenses has, in one grouped query.
 *
 * Counts and not the notes themselves: a list of two hundred expenses would
 * otherwise ship every note body in the period, for a marker that only needs to
 * know whether there is anything to look at. The sheet fetches the real thing
 * when it opens.
 */
async function noteCountsFor(
  db: Db,
  spaceId: string,
  expenseIds: ReadonlyArray<string>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (expenseIds.length === 0) return out

  const rows = await db
    .select({ expenseId: expenseNote.expenseId, total: drizzleCount() })
    .from(expenseNote)
    .where(
      and(
        eq(expenseNote.spaceId, spaceId),
        inArray(expenseNote.expenseId, [...expenseIds]),
      ),
    )
    .groupBy(expenseNote.expenseId)

  for (const r of rows) out.set(r.expenseId, r.total)
  return out
}

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

    // Catch up any repeating expenses before reading. See `recurring_expense`:
    // there is no scheduler here, so "due" is resolved the first time anybody
    // looks. Cheap when nothing is due — one indexed query on a partial index.
    await materialiseRecurring(data.spaceId)

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
      // And a second alias for whoever typed the entry in, which is a different
      // person from the payer as often as not.
      .leftJoin(author, eq(expense.createdByUserId, author.id))
      // Left, not inner: a hand-typed expense has no series and must still be
      // listed. This join is only here so the "Repeats monthly" marker can tell a
      // live series from a stopped one.
      .leftJoin(recurringExpense, eq(expense.recurringId, recurringExpense.id))
      .where(and(...conditions))
      .orderBy(desc(expense.spentOn), desc(expense.createdAt))
      .limit(data.limit)

    const splitMap = await splitsFor(
      data.spaceId,
      rows.map((r) => r.id),
    )
    const noteMap = await noteCountsFor(
      db,
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
      noteCount: noteMap.get(r.id) ?? 0,
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

    // Same catch-up as `listExpenses`, and it has to be here too: the dashboard
    // is the landing page, so if only the ledger page materialised, the first
    // thing anybody saw each month would be last month's total.
    await materialiseRecurring(data.spaceId)

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

    const [all] = await db
      .select({
        total: sql<number>`coalesce(sum(${expense.amountMinor}), 0)::int`,
        n: drizzleCount(),
      })
      .from(expense)
      .where(and(...conditions))
    const totalMinor = Number(all?.total ?? 0)
    const count = Number(all?.n ?? 0)

    // Entries without a category belong to no row of the breakdown above, so
    // they get a row of their own — same shape, toggleable like any other.
    // The same `conditions` (including any category selection) scope it: with
    // a real category picked and Uncategorised not among them, this counts
    // nothing and no row is appended.
    const [uncat] = await db
      .select({
        total: sql<number>`coalesce(sum(${expense.amountMinor}), 0)::int`,
        n: drizzleCount(),
      })
      .from(expense)
      .where(and(...conditions, isNull(expense.categoryId)))
    if (Number(uncat?.n ?? 0) > 0) {
      byCategory.push({
        id: UNCATEGORISED_ID,
        name: 'Uncategorised',
        // Grey is not a swatch anyone can paint a category — see swatchColor,
        // which passes raw CSS through for exactly this row.
        color: 'var(--color-rule)',
        icon: 'tag',
        totalMinor: uncat?.total ?? 0,
        count: uncat?.n ?? 0,
      })
    }

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
      byCategory: byCategory
        .map((c) => ({
          ...c,
          totalMinor: Number(c.totalMinor),
          count: Number(c.count),
        }))
        .sort((a, b) => b.totalMinor - a.totalMinor),
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
  /** Payments already recorded in this range, newest first. */
  recorded: Array<RecordedSettlement>
  yourNetMinor: number
  yourMemberId: string
}

/**
 * Per-member balance over a range, plus a minimal settlement plan.
 *
 * net = paid − share. Positive means the household owes them.
 *
 * Recorded payments are taken off the nets before the plan is drawn, which is
 * what makes the plan clearable: pay somebody, record it, and their line goes
 * away instead of coming back month after month.
 */
export const getBalances = createServerFn({ method: 'GET' })
  .inputValidator(periodFilterSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession()
    const me = await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    // Balances reads the same ledger, so it catches up too. Without this, a tab
    // left open on Balances would show last month's rent as the only one there
    // was.
    await materialiseRecurring(data.spaceId)

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

    /*
     * Take recorded payments off the nets. A payment from A to B discharges A's
     * debt, so A's net rises and B's falls — see `applySettlements`, which is
     * where the arithmetic and the reasoning live.
     */
    const recorded = await loadSettlements(data.spaceId, session.user.id, {
      from: data.from,
      to: data.to,
    })
    const adjusted = applySettlements(balances, recorded)

    // Total of the nets must be zero. If it is not, some share rows are
    // outside the filter and the settlement plan would be wrong; surface it
    // rather than settling a phantom amount.
    const netSum = adjusted.reduce((s, b) => s + b.netMinor, 0)
    if (netSum !== 0) {
      console.warn(
        `[balances] net does not balance (${netSum} minor units) for space ${data.spaceId}`,
      )
    }

    return {
      balances: adjusted,
      settlements: settle(adjusted),
      recorded,
      yourNetMinor: adjusted.find((b) => b.memberId === me.id)?.netMinor ?? 0,
      yourMemberId: me.id,
    } satisfies BalancesResult
  })
