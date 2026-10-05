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
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'

import { z } from 'zod'
import {
  ensureSession,
  requireSpaceMember,
  requireSpaceOwner,
} from './auth.functions'
import { getDb } from './db'
import {
  category,
  expense,
  recurringExpense,
  settlement,
  space,
  spaceInvite,
  spaceMember,
  user,
} from './db/schema'
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
 * Four foreign keys are `onDelete: 'restrict'` — `expense_split.member_id`,
 * `expense.category_id`, `settlement.from_member_id` and
 * `recurring_expense_split.member_id` — because archiving a member or a category
 * that other rows still point at would silently rewrite history. A bare
 * `delete from space` does survive: Postgres happens to fire the
 * space → expense cascade before the space → space_member one, so the splits
 * are already gone by the time RESTRICT is checked.
 *
 * "Happens to" is not a property to build on. Cascade order is an artefact of
 * trigger OIDs, not a guarantee, and the day it changes this becomes a delete
 * that fails with a foreign key violation on real data — for the one operation
 * where a failure is least welcome. So everything goes first, explicitly, and
 * the restrict rules are never asked to make a decision they were not written
 * to make.
 *
 * EVERY table with a member-keyed restrict has to be named here, and two were
 * missed when their features landed. `settlement` and `recurringExpense` were both
 * added after this function was written and neither was added to the list, so
 * deleting a household that had recorded a payment — or a rent, or an internet
 * bill, which is to say almost every household that exists — died on a foreign key
 * violation, on the one button whose whole purpose is to be reliable. It survived
 * in tests because the fixture household had neither.
 */
export async function purgeSpace(db: Db, spaceId: string) {
  return db.transaction(async (tx) => {
    // Cascades to recurring_expense_split, clearing its restrict on member_id.
    // Before the expenses, because expense.recurring_id is `set null` — deleting
    // the template first only unhooks the entries, which the next line removes.
    // Cascades to expense_split and expense_note, clearing the restrict on
    // expense_split.member_id.
    await tx.delete(expense).where(eq(expense.spaceId, spaceId))
    // Cascades to recurring_expense_split, clearing its restrict on member_id.
    await tx
      .delete(recurringExpense)
      .where(eq(recurringExpense.spaceId, spaceId))
    // No children of its own, and it restricts on member_id twice.
    await tx.delete(settlement).where(eq(settlement.spaceId, spaceId))
    // Nothing cascades from these — they have no children — and both restrict on
    // member_id, so they have to be gone before the members are.
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
 * One row of the roster, as `listMembers` returns it.
 *
 * Named rather than reusing `SpaceMember` because it is not that type: it carries
 * `userAvatar`, which comes from the joined account and does not live on the
 * member row at all. Callers that type a prop as `SpaceMember` therefore silently
 * lose the avatar, which is exactly the mistake this type exists to make
 * impossible.
 */
export interface MemberListItem {
  id: string
  spaceId: string
  userId: string | null
  displayName: string
  color: string
  defaultWeightBp: number
  role: 'owner' | 'member'
  archivedAt: Date | null
  createdAt: Date
  /** Their account avatar key, or null for a virtual member. */
  userAvatar: string | null
}

/**
 * Members of a space. `userId` is null for a virtual member — someone carrying a
 * share without ever registering.
 *
 * `userAvatar` comes from the joined account, so it is null for a virtual member
 * and for one whose account is gone. That is not a gap: a virtual member has no
 * account to hold an avatar, and every caller passes the member id as the seed
 * so the component derives a stable identicon instead. Two people on one roster
 * therefore still look different, which is the whole point of drawing them.
 */
export const listMembers = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ spaceId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    return (
      db
        .select({
          id: spaceMember.id,
          spaceId: spaceMember.spaceId,
          userId: spaceMember.userId,
          displayName: spaceMember.displayName,
          color: spaceMember.color,
          defaultWeightBp: spaceMember.defaultWeightBp,
          role: spaceMember.role,
          archivedAt: spaceMember.archivedAt,
          createdAt: spaceMember.createdAt,
          userAvatar: user.avatar,
        })
        .from(spaceMember)
        // Left, not inner: a virtual member has no account row, and an inner join
        // would drop every one of them from the roster.
        .leftJoin(user, eq(spaceMember.userId, user.id))
        .where(
          and(
            eq(spaceMember.spaceId, data.spaceId),
            isNull(spaceMember.archivedAt),
          ),
        )
        .orderBy(asc(spaceMember.createdAt))
    )
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
      // `removed`, and only ever `removed`: this handler is the owner taking
      // somebody off the roster. Walking is `leaveSpace`, which writes `left`, so
      // the two cannot be confused by whoever is told about it later.
      .set({ archivedAt: new Date(), archivedReason: 'removed' })
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

/**
 * Leave a household yourself.
 *
 * The roster is not a place you get stuck: leaving is something you can always
 * do, which is why it is a button rather than a thing you ask an owner to do for
 * you. Archiving is the same operation as `archiveMember` in reverse — the row
 * stays, `user_id` goes to NULL, and every split that referenced it keeps this
 * person's name — so the ledger does not rewrite itself when a household
 * changes.
 *
 * THE OWNER PROBLEM, because this is the one a self-service leave has that the
 * reverse does not. A household with no owner cannot be managed, which is why
 * `archiveMember` refuses to remove the last one. Leaving has to solve that
 * rather than trip over it, so the longest-standing remaining member is promoted
 * first and the departure goes ahead. That is the same handover account deletion
 * performs, and for the same reason: an owner walking out should not take the
 * household's administration with them.
 *
 * The exception is being the only member at all. There is nobody to hand over to
 * and nobody to strand, so the space goes — see `purgeSpace` for why the expenses
 * are deleted explicitly rather than left to a restrict rule to decide.
 */
export const leaveSpace = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ spaceId: uuidSchema }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    const member = await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const others = await db
      .select({
        id: spaceMember.id,
        role: spaceMember.role,
        // Needed to pick an heir who can actually log in: a virtual member has no
        // account, so promoting one would hand administration of the household to
        // a row nobody can sign in as. The `?? others[0]` fallback covers the case
        // where every remaining member is virtual, where a virtual owner is still
        // better than a household with none.
        userId: spaceMember.userId,
        createdAt: spaceMember.createdAt,
      })
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.spaceId, data.spaceId),
          sql`${spaceMember.id} is distinct from ${member.id}`,
          isNull(spaceMember.archivedAt),
        ),
      )
      .orderBy(asc(spaceMember.createdAt))

    if (others.length === 0) {
      // The last person out turns the lights off. Cascading is not enough on its
      // own: expense_split.restrict on member_id means Postgres may or may not
      // order the cascades favourably, and which it does is trigger-OID luck
      // rather than a guarantee.
      await purgeSpace(db, data.spaceId)
      return { ok: true as const, deletedSpace: true }
    }

    // Hand over before leaving, so there is never a moment with no owner.
    if (member.role === 'owner') {
      const heir = others.find((o) => o.userId !== null) ?? others[0]!
      await db
        .update(spaceMember)
        .set({ role: 'owner' })
        .where(eq(spaceMember.id, heir.id))
    }

    await db
      .update(spaceMember)
      .set({ archivedAt: new Date(), archivedReason: 'left' })
      .where(eq(spaceMember.id, member.id))

    return { ok: true as const, deletedSpace: false }
  })

/**
 * Households this account was removed from and has not been told about.
 *
 * Drives the notice shown on the next sign-in. Deliberately excludes a
 * departure you chose: being told you were removed from somewhere you left
 * yourself would be nonsense, and the two are only distinguishable because
 * `archived_reason` records which happened.
 *
 * Unacknowledged only, so it appears once and then stops. Reads the space name so
 * the notice can say *which* household rather than making the person guess.
 */
export const listRemovalNotices = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await ensureSession()
    const db = getDb()

    return db
      .select({ spaceId: space.id, spaceName: space.name })
      .from(spaceMember)
      .innerJoin(space, eq(spaceMember.spaceId, space.id))
      .where(
        and(
          eq(spaceMember.userId, session.user.id),
          eq(spaceMember.archivedReason, 'removed'),
          isNull(spaceMember.removalAckAt),
        ),
      )
      .orderBy(desc(spaceMember.archivedAt))
  },
)

/**
 * Mark every pending removal notice as seen.
 *
 * No ids in the payload, so it cannot be used to acknowledge somebody else's
 * notice: it acknowledges the caller's own rows and nothing else.
 */
export const ackRemovalNotices = createServerFn({ method: 'POST' }).handler(
  async () => {
    const session = await ensureSession()
    const db = getDb()

    await db
      .update(spaceMember)
      .set({ removalAckAt: new Date() })
      .where(
        and(
          eq(spaceMember.userId, session.user.id),
          eq(spaceMember.archivedReason, 'removed'),
          isNull(spaceMember.removalAckAt),
        ),
      )
    return { ok: true as const }
  },
)

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
