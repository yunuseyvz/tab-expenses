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
import { category, expense, space, spaceMember } from './db/schema'
import {
  avatarKeySchema,
  categoryInputSchema,
  categoryUpdateSchema,
  currencySchema,
  memberInputSchema,
  memberUpdateSchema,
  uuidSchema,
} from './guards'

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
          'The currency cannot change once a space has expenses — every amount was entered in the old one.',
        )
      }
    }

    const [row] = await db
      .update(space)
      .set({
        name: data.name,
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
      })
      // Scoped by id only because requireSpaceOwner has already established
      // that this caller owns exactly this space.
      .where(eq(space.id, data.spaceId))
      .returning()

    if (!row) throw new Error('Not found')
    return row
  })

/**
 * Does this space have any expenses?
 *
 * Only needed to decide whether the currency can still be changed, and only once
 * the editor is open — so it is a separate call rather than a count column on
 * every row of the space list, which is loaded on every screen.
 */
export const spaceHasExpenses = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ spaceId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(expense)
      .where(eq(expense.spaceId, data.spaceId))
    return Number(row?.n ?? 0) > 0
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
 * Members of a space. `userId` is null for a virtual member — Vater or Vale
 * carrying a share without ever registering.
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

    // The last owner cannot be archived — the space would be unmanageable.
    const remaining = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.spaceId, data.spaceId),
          eq(spaceMember.role, 'owner'),
          isNull(spaceMember.archivedAt),
        ),
      )
    if ((remaining[0]?.n ?? 0) <= 1) {
      throw new Error('Cannot archive the last owner')
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
