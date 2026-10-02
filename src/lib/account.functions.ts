/**
 * Deleting your own account.
 *
 * Two things have to be true at once and neither is obvious on its own:
 *
 *   1. The account really goes. Sessions, accounts and outstanding OTP codes
 *      cascade from `user`. That is the only irreversible part, and it is why
 *      this sits behind a dialog rather than a settings row that fires.
 *
 *   2. Nobody else's ledger breaks. `expense_split.member_id` and
 *      `expense.category_id` are `restrict` on purpose, so deleting a person
 *      cannot quietly rewrite a housemate's history. Those rows are kept, and
 *      the roster entry is archived rather than removed — the same thing
 *      "Remove member" does, reached the other way round.
 *
 * The awkward case is ownership. A household with no owner cannot be managed,
 * which is why archiveMember refuses to archive the last one. Deleting an
 * account has to solve that rather than trip over it, so for each household the
 * departing person owned:
 *
 *   - somebody else is still on it → the longest-standing of them becomes owner.
 *     Automatic, and the alternative is a household nobody can invite to.
 *   - nobody else is on it → the household goes too, along with its expenses.
 *     It was already unreachable — every roster row belongs to the person
 *     leaving — and keeping it would strand a ledger that nobody can ever open
 *     or delete.
 *
 * That second rule is destructive, so it is stated in the dialog rather than
 * discovered afterwards, and the count of households the caller will lose comes
 * from the server (accountDeletionPreview) rather than the client, which cannot
 * see who is on a household it is not a member of.
 */
import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'

import { ensureSession } from './auth.functions'
import { getDb } from './db'
import { expense, space, spaceMember, user } from './db/schema'
import type { Db } from './db'

/**
 * The read half of a Drizzle executor.
 *
 * `Db` and a transaction have the same `select` but not the same type — the pool
 * carries a `$client` the transaction does not — and this query has to run both
 * inside `purgeAccount`'s transaction and outside it for the preview. Taking the
 * one method that is genuinely identical is what lets both callers share it
 * without a cast.
 */
type Reader = Pick<Db, 'select'>

/**
 * Every other *registered* member on these households, oldest first.
 *
 * Registered, not merely present. `userId is distinct from` would also be true
 * for a NULL — that is, for a virtual member — and a virtual member cannot own a
 * household because there is no account to sign in as. So `ne()` is doing real
 * work here beyond tidiness: a household where the only other roster entry is a
 * virtual member has nobody to hand over to, and must be treated as empty.
 *
 * "Longest-standing" is the order that means "was here first" rather than "was
 * added first", and it is what makes handing over an owner role predictable.
 */
async function otherActiveMembers(
  db: Reader,
  spaceIds: Array<string>,
  userId: string,
) {
  if (!spaceIds.length) return []
  return db
    .select({
      spaceId: spaceMember.spaceId,
      id: spaceMember.id,
      createdAt: spaceMember.createdAt,
    })
    .from(spaceMember)
    .where(
      and(
        inArray(spaceMember.spaceId, spaceIds),
        ne(spaceMember.userId, userId),
        isNull(spaceMember.archivedAt),
      ),
    )
    .orderBy(asc(spaceMember.createdAt))
}

/** Grouped by household, in the order otherActiveMembers returned them. */
function byHousehold(
  rows: Array<{ spaceId: string; id: string }>,
): Map<string, Array<{ id: string }>> {
  const out = new Map<string, Array<{ id: string }>>()
  for (const row of rows) {
    const list = out.get(row.spaceId)
    if (list) list.push(row)
    else out.set(row.spaceId, [row])
  }
  return out
}

/**
 * What deleting this account would cost, so the dialog can say it.
 *
 * A server function rather than something derived from the page: whether you are
 * the last member of a household is a fact about every household you belong to,
 * and the settings screen only ever loads the roster of the one currently open.
 */
export const accountDeletionPreview = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await ensureSession()
    const db = getDb()

    const memberships = await db
      .select({ spaceId: spaceMember.spaceId, role: spaceMember.role })
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.userId, session.user.id),
          isNull(spaceMember.archivedAt),
        ),
      )

    const household = byHousehold(
      await otherActiveMembers(
        db,
        memberships.map((m) => m.spaceId),
        session.user.id,
      ),
    )
    const stays = memberships.filter((m) => household.has(m.spaceId))
    const goes = memberships.filter((m) => !household.has(m.spaceId))

    return {
      staying: stays.length,
      going: goes.length,
      owned: memberships.filter((m) => m.role === 'owner').length,
    }
  },
)

/**
 * Remove an account and leave every ledger that referenced it intact.
 *
 * Exported separately from the server function for the same reason purgeSpace
 * is: the guard belongs at the edge, the graph work does not, and the graph work
 * is what is worth testing against a real database.
 */
export async function purgeAccount(db: Db, userId: string) {
  return db.transaction(async (tx) => {
    const memberships = await tx
      .select({
        spaceId: spaceMember.spaceId,
        memberId: spaceMember.id,
        role: spaceMember.role,
      })
      .from(spaceMember)
      .where(
        and(eq(spaceMember.userId, userId), isNull(spaceMember.archivedAt)),
      )

    const household = byHousehold(
      await otherActiveMembers(
        tx,
        memberships.map((m) => m.spaceId),
        userId,
      ),
    )

    const owned = memberships
      .filter((m) => m.role === 'owner')
      .map((m) => m.spaceId)

    // A household where this person was the only member has no reachable roster
    // left, so it goes with them. Expenses first, for the reason given in
    // purgeSpace: the restrict rules must never be what decides the order.
    for (const spaceId of owned) {
      if (household.has(spaceId)) continue
      await tx.delete(expense).where(eq(expense.spaceId, spaceId))
      await tx.delete(space).where(eq(space.id, spaceId))
    }

    // Hand over the households that survive. One promotion is enough; a
    // household has never needed more than one owner.
    for (const spaceId of owned) {
      const heir = household.get(spaceId)?.[0]
      if (!heir) continue
      await tx
        .update(spaceMember)
        .set({ role: 'owner' })
        .where(eq(spaceMember.id, heir.id))
    }

    // Archive rather than delete the roster row: expense_split restricts on it,
    // and that restriction is the thing keeping last quarter's balances honest.
    // Deleting the user sets its user_id to NULL, which is what turns this row
    // into a virtual member and keeps the name on every old split.
    if (memberships.length) {
      await tx
        .update(spaceMember)
        .set({ archivedAt: new Date() })
        .where(
          inArray(
            spaceMember.id,
            memberships.map((m) => m.memberId),
          ),
        )
    }

    const [row] = await tx
      .delete(user)
      .where(eq(user.id, userId))
      .returning({ id: user.id })

    if (!row) throw new Error('Not found')
    return { ok: true as const, deletedId: row.id }
  })
}

export const deleteAccount = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ confirmEmail: z.email() }))
  .handler(async ({ data }) => {
    const session = await ensureSession()

    /**
     * Type your email address to confirm.
     *
     * Not decoration. Server functions are plain HTTP endpoints, so the dialog in
     * front of this is a courtesy to the person using it and no obstacle to
     * anyone who is not — and the one thing standing between a stray call and an
     * unrecoverable delete is a value the caller has to have read off the
     * account. The comparison is on the server because a client-side one is the
     * one that can be skipped.
     *
     * A password is the usual answer and this app has none: sign-in is an
     * emailed code, so there is no secret to ask for. The address is what the
     * account actually has.
     */
    const typed = data.confirmEmail.trim().toLowerCase()
    const actual = session.user.email.toLowerCase()
    if (typed !== actual) {
      throw new Error('That is not the address on this account')
    }

    return purgeAccount(getDb(), session.user.id)
  })
