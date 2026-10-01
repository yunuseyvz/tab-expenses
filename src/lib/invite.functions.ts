/**
 * Invitations to a space.
 *
 * The model: an owner types an address, a link is emailed, and the recipient
 * accepts. That is deliberately *not* the simpler "owner types an address and
 * the member appears immediately", for three reasons that turned out to matter:
 *
 *   • the recipient may not have an account yet, and pre-inviting them is the
 *     normal case for a household app — you invite the people you live with;
 *   • a mistyped address would otherwise become a real member who owns a share
 *     of your ledger, with no undo short of finding them;
 *   • the recipient should get to see *which* household is asking before they
 *     join it.
 *
 * SECURITY. Two things are required to become a member, and both must hold:
 *
 *   1. possession of a valid, unexpired, unaccepted token (emailed, so it goes
 *      to the address the owner typed); and
 *   2. a session whose email is exactly that address.
 *
 * The token alone is not enough, and the email match alone is not enough. A
 * leaked or forwarded link therefore grants nothing on its own — someone reading
 * over your shoulder, or a stale link in a chat history, cannot join. The
 * converse matters too: the owner cannot add someone who never asked, because
 * the member row is only written by acceptInvite, never by createInvite.
 *
 * Only the sha256 of the token is stored. A database dump yields no live invite
 * links, the same reasoning as `storeOTP: 'hashed'`.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, isNull } from 'drizzle-orm'

import { z } from 'zod'
import { env } from './db/env'
import { ensureSession, requireSpaceOwner } from './auth.functions'
import { getDb } from './db'
import { space, spaceInvite, spaceMember, user } from './db/schema'
import { sendInviteEmail } from './email'

/** How long an invitation stays valid. */
const INVITE_TTL_DAYS = 14

/** base64url, no padding — safe to drop straight into a URL path. */
function newToken() {
  return randomBytes(32).toString('base64url')
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Pick a display name for the new member.
 *
 * Their account name, or their email local-part if they never set one — an
 * older account predating registration would otherwise join as an empty row,
 * which looks broken in every expense list.
 */
function displayNameFor(
  accountName: string | null | undefined,
  email: string,
): string {
  const name = accountName?.trim()
  if (name) return name
  const local = email.split('@')[0] ?? email
  return local.charAt(0).toUpperCase() + local.slice(1)
}

// ── owner-facing ──────────────────────────────────────────────────────────

export const createInvite = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      spaceId: z.uuid(),
      email: z.email().transform((e) => e.trim().toLowerCase()),
      role: z.enum(['owner', 'member']).default('member'),
    }),
  )
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceOwner(session.user.id, data.spaceId)
    const db = getDb()

    // Don't invite someone who is already in. This joins to the user table
    // because the member row only stores a user id, while the owner typed an
    // email address.
    const members = await db
      .select({ email: user.email })
      .from(spaceMember)
      .innerJoin(user, eq(spaceMember.userId, user.id))
      .where(
        and(
          eq(spaceMember.spaceId, data.spaceId),
          isNull(spaceMember.archivedAt),
        ),
      )

    if (members.some((m) => m.email.toLowerCase() === data.email)) {
      throw new Error('That person is already in this space')
    }

    // Refuse to invite yourself: it would create a second member row for one
    // account, and space_member_space_user_uq would reject the insert at accept
    // time with a far less obvious error.
    if (data.email === session.user.email.toLowerCase()) {
      throw new Error('You are already in this space')
    }

    const token = newToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000)

    // The partial unique index allows one live invite per (space, email), so a
    // re-invite rotates the existing row. The previous link stops working, which
    // is the right behaviour: a second invitation supersedes the first.
    //
    // targetWhere is not optional decoration here. The index is partial
    // (`where accepted_at is null`), and Postgres will not match a conflict
    // target to a partial index unless the predicate is restated — without it
    // every invite fails with a bare ON CONFLICT error.
    const [row] = await db
      .insert(spaceInvite)
      .values({
        spaceId: data.spaceId,
        email: data.email,
        tokenHash,
        role: data.role,
        expiresAt,
        invitedByUserId: session.user.id,
      })
      .onConflictDoUpdate({
        target: [spaceInvite.spaceId, spaceInvite.email],
        targetWhere: isNull(spaceInvite.acceptedAt),
        set: { tokenHash, role: data.role, expiresAt, acceptedAt: null },
      })
      .returning()
      .catch((err: unknown) => {
        // Postgres error text carries column names, the hashed token's params
        // and the constraint name. None of that belongs in a toast, so it goes
        // to the log and the owner gets a sentence.
        console.error('[invite] insert failed', err)
        throw new Error('Could not create the invitation. Try again.')
      })

    // Send after the row is committed. If the mail fails the invite still exists
    // and the owner can resend, which beats the reverse: a link that works but
    // was never delivered looks like a dead button with no way to diagnose it.
    const [host] = await db
      .select({ name: space.name })
      .from(space)
      .where(eq(space.id, data.spaceId))

    try {
      await sendInviteEmail({
        to: data.email,
        spaceName: host!.name,
        // name is NOT NULL, but an account created before registration was introduced
        // may hold an empty string, so the fallback is still load-bearing.
        inviterName: session.user.name.trim() || 'Someone',
        acceptUrl: `${env().BETTER_AUTH_URL.replace(/\/$/, '')}/invite/${token}`,
        expiresAt,
      })
    } catch (err) {
      console.error('[invite] delivery failed', err)
      return {
        inviteId: row!.id,
        emailed: false as const,
        message: 'Invite created, but the email could not be sent.',
      }
    }

    return { inviteId: row!.id, emailed: true as const }
  })

export const listInvites = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ spaceId: z.uuid() }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceOwner(session.user.id, data.spaceId)
    const db = getDb()

    const rows = await db
      .select({
        id: spaceInvite.id,
        email: spaceInvite.email,
        role: spaceInvite.role,
        expiresAt: spaceInvite.expiresAt,
        acceptedAt: spaceInvite.acceptedAt,
        createdAt: spaceInvite.createdAt,
      })
      .from(spaceInvite)
      .where(eq(spaceInvite.spaceId, data.spaceId))
      .orderBy(desc(spaceInvite.createdAt))

    const now = Date.now()
    return rows.map((r) => ({
      ...r,
      status: r.acceptedAt
        ? ('accepted' as const)
        : r.expiresAt.getTime() < now
          ? ('expired' as const)
          : ('pending' as const),
    }))
  })

export const revokeInvite = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ spaceId: z.uuid(), inviteId: z.uuid() }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    await requireSpaceOwner(session.user.id, data.spaceId)
    const db = getDb()

    // Scoped by spaceId so an owner of one space cannot revoke another's invite
    // by guessing its id.
    const [row] = await db
      .delete(spaceInvite)
      .where(
        and(
          eq(spaceInvite.id, data.inviteId),
          eq(spaceInvite.spaceId, data.spaceId),
        ),
      )
      .returning({ id: spaceInvite.id })

    if (!row) throw new Error('Not found')
    return { ok: true as const }
  })

// ── recipient-facing ──────────────────────────────────────────────────────

/**
 * What the link says, before anyone signs in.
 *
 * Public and unauthenticated on purpose: the recipient opens this while logged
 * out, and needs to know whose household is asking before they create an
 * account. Reveals only the space name and the inviter's account name — the
 * minimum for "is this the invitation I was expecting?", and nothing about the
 * ledger itself.
 */
export const getInvitePreview = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ token: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const db = getDb()
    const [row] = await db
      .select({
        email: spaceInvite.email,
        expiresAt: spaceInvite.expiresAt,
        acceptedAt: spaceInvite.acceptedAt,
        spaceName: space.name,
        invitedByName: user.name,
      })
      .from(spaceInvite)
      .innerJoin(space, eq(spaceInvite.spaceId, space.id))
      .leftJoin(user, eq(spaceInvite.invitedByUserId, user.id))
      .where(eq(spaceInvite.tokenHash, hashToken(data.token)))
      .limit(1)

    if (!row) return { status: 'invalid' as const }
    if (row.acceptedAt) return { status: 'accepted' as const }
    if (row.expiresAt.getTime() < Date.now()) {
      return { status: 'expired' as const }
    }
    return {
      status: 'ok' as const,
      email: row.email,
      spaceName: row.spaceName,
      inviterName: row.invitedByName?.trim() || 'Someone',
    }
  })

/**
 * Redeem an invitation.
 *
 * Requires a session whose email is the invited address. This is the only place
 * a real member row is created for an invited person.
 */
export const acceptInvite = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ token: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const session = await ensureSession()
    const db = getDb()

    const [invite] = await db
      .select({
        id: spaceInvite.id,
        spaceId: spaceInvite.spaceId,
        email: spaceInvite.email,
        role: spaceInvite.role,
        expiresAt: spaceInvite.expiresAt,
        acceptedAt: spaceInvite.acceptedAt,
        spaceName: space.name,
      })
      .from(spaceInvite)
      .innerJoin(space, eq(spaceInvite.spaceId, space.id))
      .where(eq(spaceInvite.tokenHash, hashToken(data.token)))
      .limit(1)

    if (!invite) throw new Error('This invitation link is not valid')

    // Order matters: report the expired/used state before the email mismatch, so
    // someone clicking an old link is told the truth about their link rather
    // than being told to use a different email.
    if (invite.acceptedAt) {
      throw new Error('This invitation has already been used')
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new Error('This invitation has expired. Ask for a new one.')
    }

    // The link is a bearer credential, but not a *sufficient* one: it only works
    // for the address it was sent to. Without this check, forwarding an
    // invitation would hand your ledger to whoever you forwarded it to.
    if (invite.email.toLowerCase() !== session.user.email.toLowerCase()) {
      throw new Error(
        `This invitation was sent to ${invite.email}. Sign in with that address to accept it.`,
      )
    }

    const [member] = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: spaceMember.id })
        .from(spaceMember)
        .where(
          and(
            eq(spaceMember.spaceId, invite.spaceId),
            eq(spaceMember.userId, session.user.id),
          ),
        )
        .limit(1)

      // Accepting twice — a double-tap, or a refresh after success — must not
      // create a second member row, which space_member_space_user_uq forbids.
      if (existing) return [{ id: existing.id, rejoined: true }]

      const [created] = await tx
        .insert(spaceMember)
        .values({
          spaceId: invite.spaceId,
          userId: session.user.id,
          displayName: displayNameFor(session.user.name, invite.email),
          color: 'sage',
          defaultWeightBp: 0,
          role: invite.role,
        })
        .returning()

      await tx
        .update(spaceInvite)
        .set({ acceptedAt: new Date() })
        .where(eq(spaceInvite.id, invite.id))

      return [{ id: created!.id, rejoined: false }]
    })

    return { spaceId: invite.spaceId, spaceName: invite.spaceName, member }
  })
