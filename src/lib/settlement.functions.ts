/**
 * Settlements: the payments that actually happened.
 *
 * Kept out of `expense.functions.ts` even though balances both reads and needs
 * them. The two are different kinds of record — an expense is spending that gets
 * split, a settlement is a transfer between two people that gets subtracted —
 * and everything that makes an expense complicated (categories, splits, weights,
 * the amount ceiling) is absent here. Sharing a file would invite sharing the
 * validators.
 */
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import { ensureSession, requireSpaceMember } from './auth.functions'
import { getDb } from './db'
import { settlement, spaceMember } from './db/schema'
import { isoDateSchema, uuidSchema } from './guards'

export interface RecordedSettlement {
  id: string
  fromMemberId: string
  fromName: string
  toMemberId: string
  toName: string
  amountMinor: number
  settledOn: string
  /** Whether the viewer may remove it. */
  canDelete: boolean
}

/**
 * The recorded payments for a household in a range, newest first.
 *
 * Range-matched on `settledOn`, the same way balances range-match on `spentOn`:
 * "this month" means the debt this month's expenses created and the payments made
 * in this month, which is the only reading under which the plan and the payments
 * cancel out.
 */
export async function loadSettlements(
  spaceId: string,
  viewerUserId: string,
  range: { from?: string | null; to?: string | null } = {},
): Promise<Array<RecordedSettlement>> {
  const db = getDb()

  const conditions = [eq(settlement.spaceId, spaceId)]
  if (range.from) conditions.push(gte(settlement.settledOn, range.from))
  if (range.to) conditions.push(lte(settlement.settledOn, range.to))

  // Two aliases of the same table, because a row names two members and a join can
  // only bind one. Without the second alias the "to" name would silently be the
  // "from" name, which is the kind of bug that looks correct on a screen where
  // both people have similar names.
  const payer = alias(spaceMember, 'payer')
  const payee = alias(spaceMember, 'payee')

  const rows = await db
    .select({
      id: settlement.id,
      fromMemberId: settlement.fromMemberId,
      fromName: payer.displayName,
      toMemberId: settlement.toMemberId,
      toName: payee.displayName,
      amountMinor: settlement.amountMinor,
      settledOn: settlement.settledOn,
      createdByUserId: settlement.createdByUserId,
    })
    .from(settlement)
    .innerJoin(payer, eq(payer.id, settlement.fromMemberId))
    .innerJoin(payee, eq(payee.id, settlement.toMemberId))
    .where(and(...conditions))
    .orderBy(desc(settlement.settledOn), desc(settlement.createdAt))

  return rows.map((r) => ({
    id: r.id,
    fromMemberId: r.fromMemberId,
    fromName: r.fromName,
    toMemberId: r.toMemberId,
    toName: r.toName,
    amountMinor: Number(r.amountMinor),
    settledOn: r.settledOn,
    // Anyone can record a payment they were part of, and anyone can take back
    // what they typed. Not owner-only: the owner was not necessarily there when
    // the cash changed hands, and a wrong row that nobody can remove is worse
    // than a row someone can.
    canDelete: r.createdByUserId === viewerUserId,
  }))
}

export const createSettlement = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      spaceId: uuidSchema,
      fromMemberId: uuidSchema,
      toMemberId: uuidSchema,
      amountMinor: z.number().int().positive(),
      settledOn: isoDateSchema,
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    if (data.fromMemberId === data.toMemberId) {
      throw new Error('A payment needs two different people')
    }

    // Both members must belong to this household. Checked here rather than left
    // to the foreign keys, which would happily accept a member id from another
    // household and record a payment that no balance query would ever see.
    const members = await db
      .select({ id: spaceMember.id })
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.spaceId, data.spaceId),
          inArray(spaceMember.id, [data.fromMemberId, data.toMemberId]),
        ),
      )
    if (members.length !== 2) throw new Error('Not found')

    const [row] = await db
      .insert(settlement)
      .values({
        spaceId: data.spaceId,
        fromMemberId: data.fromMemberId,
        toMemberId: data.toMemberId,
        amountMinor: data.amountMinor,
        settledOn: data.settledOn,
        createdByUserId: session.user.id,
      })
      .returning({ id: settlement.id })

    return { id: row!.id }
  })

export const deleteSettlement = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      spaceId: uuidSchema,
      settlementId: uuidSchema,
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceMember(session.user.id, data.spaceId)
    const db = getDb()

    const [existing] = await db
      .select({ createdByUserId: settlement.createdByUserId })
      .from(settlement)
      .where(
        and(
          eq(settlement.id, data.settlementId),
          eq(settlement.spaceId, data.spaceId),
        ),
      )
      .limit(1)
    if (!existing) throw new Error('Not found')
    if (existing.createdByUserId !== session.user.id) {
      throw new Error('Only the person who recorded this can remove it')
    }

    await db
      .delete(settlement)
      .where(
        and(
          eq(settlement.id, data.settlementId),
          eq(settlement.spaceId, data.spaceId),
        ),
      )
    return { deleted: true }
  })
