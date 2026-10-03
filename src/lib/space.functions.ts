/**
 * Spaces, members and categories.
 *
 * Every handler here follows the two-layer auth rule: `ensureSession()` then
 * `requireSpaceMember()` / `requireSpaceOwner()`. The router guard is UX; this
 * is the security boundary.
 *
 * A cross-space note: createSpace, getSession, ensureSession and listMySpaces
 * are defined in ./auth.functions, not here. `getSpace` is space-scoped and
 * does check membership.
 */
import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import { z } from 'zod'
import {
  ensureSession,
  requireSpaceMember,
  requireSpaceOwner,
} from './auth.functions'
import { getDb } from './db'
import { category, expense, space, spaceInvite, spaceMember } from './db/schema'
import {
  avatarKeySchema,
  categoryInputSchema,
  categoryUpdateSchema,
  currencySchema,
  memberInputSchema,
  memberUpdateSchema,
  uuidSchema,
} from './guards'
import type { Db } from './db'

// ── spaces ────────────────────────────────────────────────────────────────

export const createSpace = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().trim().min(1, 'name is required').max(80),
      currency: currencySchema.default('EUR'),
      displayName: z.string().trim().min(1).max(60),
      color: z.string().min(1).max(40).default('terracotta'),
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    const db = getDb()

    // The creator gets the single owner row. Insert both in one transaction so
    // we can never end up with a space that has no owner.
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(space)
        .values({
          name: data.name,
          currency: data.currency,
          createdByUserId: session.user.id,
        })
        .returning()

      if (!created) throw new Error('Failed to create space')

      const [member] = await tx
        .insert(spaceMember)
        .values({
          spaceId: created.id,
          userId: session.user.id,
          displayName: data.displayName,
          color: data.color,
          role: 'owner',
          // A single-member space defaults to 100% of its own expenses.
          defaultWeightBp: 10_000,
        })
        .returning()

      return { space: created, member: member! }
    })
  })

/**
 * Edit a space. Owners only.
 *
 * Name and icon are freely editable. Currency is not, once the space has any
 * expenses: every `amount_minor` was entered in the old unit, and relabelling
 * the column would silently restate a household's whole history — €1,200 of
 * rent would become $1,200 without anyone touching it. So an empty space may
 * change currency, and a non-empty one must keep it. That is a deliberate
 * restriction rather than a missing feature; there is no FX conversion anywhere
 * in this app and inventing one here would be the worst possible place to start.
 */
export const updateSpace = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      spaceId: uuidSchema,
      name: z.string().trim().min(1, 'name is required').max(80),
      currency: currencySchema.optional(),
      icon: avatarKeySchema.nullable().optional(),
      /**
       * Whether members may edit each other's expenses. Owner-only, and read
       * back in the UI so the switch shows the stored value rather than an
       * optimistic local one that a rejected write would leave lying.
       */
      editableByMembers: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceOwner(session.user.id, data.spaceId)
    const db = getDb()

    if (data.currency !== undefined) {
      const [count] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(expense)
        .where(eq(expense.spaceId, data.spaceId))
      if (Number(count?.n ?? 0) > 0) {
        throw new Error(
          'The currency cannot change once a space has expenses. Every amount was entered in the old one.',
        )
      }
    }

    const [row] = await db
      .update(space)
      .set({
        name: data.name,
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...(data.editableByMembers !== undefined
          ? { editableByMembers: data.editableByMembers }
          : {}),
      })
      // Scoped by id only because requireSpaceOwner has already established
      // that this caller owns exactly this space.
      .where(eq(space.id, data.spaceId))
      .returning()

    if (!row) throw new Error('Not found')
    return row
  })

/**
 * What this space holds, and how much of it.
 *
 * Counts serve two jobs from one call, and only once the editor is open — it is
 * not a column on the space list, which is loaded on every screen.
 *
 *   expenses > 0  locks the currency, so a rename cannot restate history
 *   the rest     is what the delete confirmation has to state, because a
 *                warning that says "this cannot be undone" without saying
 *                *what* is being destroyed is not a warning
 */
export const spaceSummary = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ spaceId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceOwner(session.user.id, data.spaceId)
    const db = getDb()
    const [row] = await db
      .select({
        expenses: sql<number>`(
          select count(*)::int from ${expense} where ${expense.spaceId} = ${data.spaceId}
        )`,
        members: sql<number>`(
          select count(*)::int from ${spaceMember} where ${spaceMember.spaceId} = ${data.spaceId}
        )`,
        categories: sql<number>`(
          select count(*)::int from ${category} where ${category.spaceId} = ${data.spaceId}
        )`,
        // Only outstanding invites. An accepted one is a dead row, and
        // counting it would overstate what a person still has to lose.
        invites: sql<number>`(
          select count(*)::int from ${spaceInvite}
          where ${spaceInvite.spaceId} = ${data.spaceId}
            and ${spaceInvite.acceptedAt} is null
        )`,
        // The amount, not just the count. "9 expenses" is an abstraction;
        // "9 expenses, €3,229.24" is the thing someone is about to lose.
        totalMinor: sql<number>`(
          select coalesce(sum(${expense.amountMinor}), 0)::int
          from ${expense} where ${expense.spaceId} = ${data.spaceId}
        )`,
      })
      .from(space)
      .where(eq(space.id, data.spaceId))
      .limit(1)

    return {
      expenses: Number(row?.expenses ?? 0),
      members: Number(row?.members ?? 0),
      categories: Number(row?.categories ?? 0),
      invites: Number(row?.invites ?? 0),
      totalMinor: Number(row?.totalMinor ?? 0),
    }
  })

/**
 * Delete a space and everything in it.
 *
 * Separated from the request wrapper and given the database as an argument so
 * the test suite can call the real thing. This is the most destructive code in
 * the app and it must not be the one function in `src/lib` that can only ever
 * be exercised by clicking through a browser.
 *
 * IRREVERSIBLE. There is no trash, no soft delete and no undo: a household's
 * whole expense history, its roster, its categories and any outstanding invite
 * links are gone in the same transaction. The client makes you type the space's
 * name to get here, which is the only thing standing between a mis-tap and that.
 *
 * THE ORDER IS THE POINT
 * Two foreign keys are `onDelete: 'restrict'` — `expense_split.member_id` and
 * `expense.category_id` — because archiving a member or a category that other
 * rows still point at would silently rewrite history. A bare
 * `delete from space` does survive: Postgres happens to fire the
 * space → expense cascade before the space → space_member one, so the splits
 * are already gone by the time RESTRICT is checked.
 *
 * "Happens to" is not a property to build on. Cascade order is an artefact of
 * trigger OIDs, not a guarantee, and the day it changes this becomes a delete
 * that fails with a foreign key violation on real data — for the one operation
 * where a failure is least welcome. So the expenses go first, explicitly, and
 * the restrict rules are never asked to make a decision they were not written
 * to make.
 */
export async function purgeSpace(db: Db, spaceId: string) {
  return db.transaction(async (tx) => {
    // Cascades to expense_split, clearing the restrict on member_id.
    await tx.delete(expense).where(eq(expense.spaceId, spaceId))
    // Cascades to space_member, category and space_invite. Nothing references
    // a category any more, so the restrict on expense.category_id is moot.
    const [row] = await tx
      .delete(space)
      .where(eq(space.id, spaceId))
      .returning({
        id: space.id,
      })

    if (!row) throw new Error('Not found')
    return { ok: true as const, deletedId: row.id }
  })
}

/** Owners only. The guard is here, not in purgeSpace, which has no session. */
export const deleteSpace = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ spaceId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceOwner(session.user.id, data.spaceId)
    return purgeSpace(getDb(), data.spaceId)
  })

export const getSpace = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ spaceId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const [row] = await db
      .select()
      .from(space)
      .where(eq(space.id, data.spaceId))
      .limit(1)
    return row ?? null
  })

// ── members ───────────────────────────────────────────────────────────────

/**
 * Members of a space. `userId` is null for a virtual member — someone carrying a
 * share without ever registering.
 */
export const listMembers = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ spaceId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    return db
      .select()
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.spaceId, data.spaceId),
          isNull(spaceMember.archivedAt),
        ),
      )
      .orderBy(asc(spaceMember.createdAt))
  })

export const createMember = createServerFn({ method: 'POST' })
  .inputValidator(memberInputSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const [row] = await db
      .insert(spaceMember)
      .values({
        spaceId: data.spaceId,
        userId: null, // virtual member — created from the roster, never a login
        displayName: data.displayName,
        color: data.color,
        defaultWeightBp: data.defaultWeightBp,
      })
      .returning()

    return row!
  })

export const updateMember = createServerFn({ method: 'POST' })
  .inputValidator(memberUpdateSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    // Scope the update by spaceId as well as memberId so a member of another
    // space cannot be edited by guessing an id.
    const [row] = await db
      .update(spaceMember)
      .set({
        displayName: data.displayName,
        color: data.color,
        defaultWeightBp: data.defaultWeightBp,
      })
      .where(
        and(
          eq(spaceMember.id, data.memberId),
          eq(spaceMember.spaceId, data.spaceId),
        ),
      )
      .returning()

    if (!row) throw new Error('Not found')
    return row
  })

export const archiveMember = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ spaceId: uuidSchema, memberId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceOwner(session.user.id, data.spaceId)
    const db = getDb()

    // The last owner cannot be archived, because a household with no owner
    // cannot be managed.
    //
    // Only when the member being archived *is* an owner. This used to count
    // owners and throw if there was one, without ever looking at who was being
    // removed, so a household with a single owner could not remove anybody at
    // all: not the other owner-less members, nobody. One person owning the
    // ledger while everybody else is on it is the ordinary case, so this locked
    // the roster in exactly the setup most people have. Reported as "Cannot
    // archive the last owner" while removing someone who was not an owner.
    const target = await db
      .select({ role: spaceMember.role })
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.id, data.memberId),
          eq(spaceMember.spaceId, data.spaceId),
        ),
      )
      .limit(1)

    if (target[0]?.role === 'owner') {
      const owners = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(spaceMember)
        .where(
          and(
            eq(spaceMember.spaceId, data.spaceId),
            eq(spaceMember.role, 'owner'),
            isNull(spaceMember.archivedAt),
          ),
        )
      if ((owners[0]?.n ?? 0) <= 1) {
        throw new Error(
          'This is the only owner of the household. Make someone else an owner before removing this one.',
        )
      }
    }

    const [row] = await db
      .update(spaceMember)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(spaceMember.id, data.memberId),
          eq(spaceMember.spaceId, data.spaceId),
        ),
      )
      .returning()

    if (!row) throw new Error('Not found')
    return row
  })

/** Link a logged-in user to an existing virtual member row. */
export const claimMember = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ spaceId: uuidSchema, memberId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    const db = getDb()

    // Claiming is a *join* operation, so membership in the space is not yet
    // required. The only precondition is that the row is an unclaimed virtual
    // member in this space, and that this user has no row yet.
    const [target] = await db
      .select()
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.id, data.memberId),
          eq(spaceMember.spaceId, data.spaceId),
          isNull(spaceMember.userId),
          isNull(spaceMember.archivedAt),
        ),
      )
      .limit(1)

    if (!target) throw new Error('Not found')

    const existing = await db
      .select({ id: spaceMember.id })
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.spaceId, data.spaceId),
          eq(spaceMember.userId, session.user.id),
        ),
      )
      .limit(1)

    // Already a member under another row: keep that row, drop the duplicate.
    if (existing[0]) {
      await db
        .update(spaceMember)
        .set({ archivedAt: new Date() })
        .where(eq(spaceMember.id, data.memberId))
      return { memberId: existing[0].id, merged: true }
    }

    const [row] = await db
      .update(spaceMember)
      .set({ userId: session.user.id })
      .where(eq(spaceMember.id, data.memberId))
      .returning()

    return { memberId: row!.id, merged: false }
  })

// ── categories ────────────────────────────────────────────────────────────

export const listCategories = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      spaceId: uuidSchema,
      includePersonal: z.boolean().default(true),
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    return db
      .select()
      .from(category)
      .where(
        and(
          eq(category.spaceId, data.spaceId),
          isNull(category.archivedAt),
          // Personal categories are excluded from shared views but remain
          // visible to the member who owns them.
          data.includePersonal ? sql`true` : sql`${category.scope} = 'shared'`,
        ),
      )
      .orderBy(asc(category.sortOrder), asc(category.name))
  })

export const createCategory = createServerFn({ method: 'POST' })
  .inputValidator(categoryInputSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    // A personal category's owner must itself be a member of this space.
    if (data.ownerMemberId) {
      const owners = await db
        .select({ id: spaceMember.id })
        .from(spaceMember)
        .where(
          and(
            eq(spaceMember.id, data.ownerMemberId),
            eq(spaceMember.spaceId, data.spaceId),
          ),
        )
        .limit(1)
      if (!owners[0]) throw new Error('Owner is not a member of this space')
    }

    const [row] = await db.insert(category).values(data).returning()
    return row!
  })

export const updateCategory = createServerFn({ method: 'POST' })
  .inputValidator(categoryUpdateSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const [row] = await db
      .update(category)
      .set({
        name: data.name,
        color: data.color,
        icon: data.icon,
        sortOrder: data.sortOrder,
      })
      .where(
        and(
          eq(category.id, data.categoryId),
          eq(category.spaceId, data.spaceId),
        ),
      )
      .returning()

    if (!row) throw new Error('Not found')
    return row
  })

export const archiveCategory = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ spaceId: uuidSchema, categoryId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    // Soft-delete: expenses keep pointing at the category, so historical
    // totals stay correct. The unique (space_id, name) index would otherwise
    // block reusing a name.
    const [row] = await db
      .update(category)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(category.id, data.categoryId),
          eq(category.spaceId, data.spaceId),
        ),
      )
      .returning({ id: category.id })

    if (!row) throw new Error('Not found')
    return { ok: true }
  })
