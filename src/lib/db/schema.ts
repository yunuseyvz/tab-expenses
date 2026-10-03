/**
 * Application schema. Better Auth's core tables live in ./auth-schema and are
 * re-exported here so drizzle-kit and the Drizzle client see one schema.
 *
 * Money is always integer minor units (cents) — never a float. Splits store
 * both `weightBp` (the editable intent) and `shareMinor` (the derived cents,
 * computed once at write time in the same transaction as the expense).
 */
import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { user } from './auth-schema'

export * from './auth-schema'

export const BP_TOTAL_DB = 10_000

/**
 * Check constraints are raw DDL, so an interpolated `sql` value would be
 * emitted as a bind parameter (`$1`) and the migrator sends no parameters —
 * every migrate would fail. `sql.raw` inlines the literal instead, keeping the
 * constraint derived from the constant rather than a second magic number.
 */
const bpTotal = sql.raw(String(BP_TOTAL_DB))

export const space = pgTable('space', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // One currency per space: sums are always meaningful, no FX maintenance.
  currency: text('currency').$type<string>().default('EUR').notNull(),
  /**
   * Avatar key for this household, from src/lib/avatars.ts. NULL means "derive
   * an identicon from the id", so a space created before avatars existed still
   * has a distinct mark rather than a blank one.
   */
  icon: text('icon'),
  /**
   * Who set this household up. Provenance, not authority: who can *manage* the
   * space is `space_member.role`, and that is the row that decides it. Which is
   * why this one is nullable and set to null when the account is deleted rather
   * than restricting the delete — an account must be deletable, and "we don't
   * remember who typed this in" is the true answer.
   */
  createdByUserId: text('created_by_user_id').references(() => user.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

/**
 * A row in a space's roster.
 *
 * `userId` is NULL for a **virtual member** — someone carrying a share without
 * ever registering. The partial unique index keeps one row per real user while
 * allowing any number of virtual members.
 *
 * Deleting an account sets `userId` to NULL rather than removing the row, which
 * leaves a former member looking exactly like a virtual one. That is the intent:
 * the person is gone, but every split that referenced them keeps their name and
 * their share, and `expense_split.member_id` restricts deletion precisely so a
 * ledger cannot quietly lose track of who paid for what.
 */
export const spaceMember = pgTable(
  'space_member',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => space.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    displayName: text('display_name').notNull(),
    color: text('color').notNull(),
    defaultWeightBp: integer('default_weight_bp').default(0).notNull(),
    role: text('role').$type<'owner' | 'member'>().default('member').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /**
     * How this row was archived, when it was.
     *
     * `removed` — an owner took this person off the roster.
     * `left` — they walked, from Settings.
     *
     * The distinction is only needed for one thing: telling somebody they were
     * removed. Without it, a person who left and a person who was removed are the
     * same row, and the only honest thing the app could do was say nothing to
     * either — which is how you get somebody logging in after being thrown out
     * of a household to find the space simply absent from their list, with no
     * account of where it went or who did it.
     *
     * NULL while the membership is live, which is the same test as archivedAt
     * being null; they are kept separate because one is *when* and this is *why*.
     */
    archivedReason: text('archived_reason').$type<'left' | 'removed'>(),
    /**
     * When this person was told.
     *
     * The notice has to survive a reload — "as soon as they log in" means the
     * next login, not only the one that happened to be open — but it must not
     * reappear on every subsequent one. An acknowledgement is what separates
     * those two, and putting it on the row rather than in localStorage means it
     * follows the person to another device.
     */
    removalAckAt: timestamp('removal_ack_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('space_member_space_user_uq')
      .on(t.spaceId, t.userId)
      .where(sql`${t.userId} is not null`),
    index('space_member_space_idx').on(t.spaceId),
    check(
      'space_member_weight_range',
      sql`${t.defaultWeightBp} between 0 and ${bpTotal}`,
    ),
    check('space_member_role_valid', sql`${t.role} in ('owner','member')`),
  ],
)

export const category = pgTable(
  'category',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => space.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    icon: text('icon').notNull(),
    // 'shared' categories appear in the common ledger; 'personal' ones belong
    // to a single member and are excluded from shared views.
    scope: text('scope')
      .$type<'shared' | 'personal'>()
      .default('shared')
      .notNull(),
    ownerMemberId: uuid('owner_member_id').references(() => spaceMember.id, {
      onDelete: 'cascade',
    }),
    sortOrder: integer('sort_order').default(0).notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('category_space_name_uq').on(t.spaceId, t.name),
    index('category_space_idx').on(t.spaceId),
    // A personal category must name its owner; a shared one must not.
    check(
      'category_scope_owner_ck',
      sql`(${t.scope} = 'shared' and ${t.ownerMemberId} is null)
          or (${t.scope} = 'personal' and ${t.ownerMemberId} is not null)`,
    ),
  ],
)

export const expense = pgTable(
  'expense',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => space.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => category.id, {
      onDelete: 'restrict',
    }),
    paidByMemberId: uuid('paid_by_member_id')
      .notNull()
      .references(() => spaceMember.id, { onDelete: 'restrict' }),
    spentOn: date('spent_on').notNull(),
    purpose: text('purpose').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    /**
     * Whether anybody but the person who typed this in may change it.
     *
     * Per expense, not per household. It was a household-wide toggle once, on the
     * reasoning that "do we trust each other with each other's entries" is one
     * question — but it is not, really: a rent transfer you had to correct
     * yourself and a grocery round you would rather nobody touched are the same
     * size of edit and not the same amount of comfort. One switch over the whole
     * ledger has to be the most cautious setting anybody ever needs, which makes
     * it useless for everything else.
     *
     * Only the author sets it (see `setExpenseLock`), so this is their call about
     * their own entry and nobody else's. Note what that implies, because it is a
     * deliberate reading of "only the creator can set it": a locked expense stays
     * locked for the household owner too. An owner who needs it changed has to
     * ask the author. That is the trade for a lock that means something — a lock
     * the owner can walk past is not a lock.
     *
     * False by default, so an expense is editable by the household until its
     * author says otherwise.
     */
    locked: boolean('locked').default(true).notNull(),
    /**
     * Who typed this in. Provenance only — the payer is `paidByMemberId`, and
     * that is the row the ledger cares about. Nullable and set null on account
     * deletion for the same reason as `space.createdByUserId`: deleting your own
     * account has to actually work.
     */
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index('expense_space_date_idx').on(t.spaceId, t.spentOn.desc()),
    index('expense_category_idx').on(t.categoryId),
    index('expense_payer_idx').on(t.paidByMemberId),
    check('expense_amount_positive', sql`${t.amountMinor} > 0`),
    // The ceiling, in the column rather than only in the request validator.
    // `amountStringSchema` and `parseAmountToMinor` both refuse it, which covers
    // every path the app has — but those are application rules, and this is the
    // one that holds if a write arrives from anywhere else. Raw DDL rather than
    // an interpolated constant for the same reason as `bpTotal` above: the
    // migrator sends no bind parameters.
    //
    // Kept just under the int4 ceiling (2 147 483 647) so a value that trips this
    // gets a sentence somebody can read rather than "integer out of range".
    check('expense_amount_within_limit', sql`${t.amountMinor} <= 999999999`),
  ],
)

export const expenseSplit = pgTable(
  'expense_split',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expense.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => spaceMember.id, { onDelete: 'restrict' }),
    // The editable intent. Survives an amount edit.
    weightBp: integer('weight_bp').notNull(),
    // The derived cents, frozen at write time. sum(share_minor) = amount_minor
    // is asserted in the same transaction as the expense write.
    shareMinor: integer('share_minor').notNull(),
  },
  (t) => [
    uniqueIndex('expense_split_expense_member_uq').on(t.expenseId, t.memberId),
    index('expense_split_member_idx').on(t.memberId),
    check(
      'expense_split_weight_range',
      sql`${t.weightBp} between 1 and ${bpTotal}`,
    ),
    check('expense_split_share_nonneg', sql`${t.shareMinor} >= 0`),
  ],
)

/**
 * A note somebody left on an expense — the sticky-note conversation under a line
 * of the ledger.
 *
 * APPEND-ONLY, and the only place remarks about an entry live. It used to be two
 * places — a `note` column on the expense beside the amount, plus this table —
 * and the sheet showed both, with different rules and no link between them.
 * The column is gone; what was typed into it arrives here as the opening note.
 * A note is never rewritten, which is the whole point of leaving one. Someone
 * who disagrees with what an expense says can say so without being able to
 * change what it says.
 *
 * EVERY MEMBER CAN LEAVE ONE, edit rights notwithstanding. Editing is about the
 * numbers; a conversation is not. Someone who cannot change the amount is exactly
 * the person who most needs to be able to write "this was the deposit, not the
 * full rent" underneath it.
 *
 * `authorName` is a snapshot, not a join. The principle is the one the roster
 * already follows — leaving or deleting an account never erases who somebody was
 * — and here it has a second payoff: a note left by somebody who has since
 * deleted their account still reads as theirs rather than as "unknown", which is
 * the difference between a record and a gap. The avatar is joined live, since a
 * missing face has an identicon to fall back on.
 */
export const expenseNote = pgTable(
  'expense_note',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The expense decides the space, but it is repeated here so a read can be
    // scoped by household in the same WHERE clause as the expense id. Without it,
    // "notes for this expense" is a query that trusts an id alone.
    spaceId: uuid('space_id')
      .notNull()
      .references(() => space.id, { onDelete: 'cascade' }),
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expense.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    authorUserId: text('author_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    authorName: text('author_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // The read order is by expense then time, and the list's count is by expense
    // alone, so this index serves both.
    index('expense_note_expense_created_idx').on(t.expenseId, t.createdAt),
    // A blank note is a note nobody left. Refused in the column rather than only
    // in the request validator, for the same reason as the amount ceiling: this
    // is the check that holds if the write arrives from somewhere else.
    check('expense_note_body_not_blank', sql`length(btrim(${t.body})) > 0`),
    check('expense_note_body_length', sql`length(${t.body}) <= 2000`),
  ],
)

export const spaceInvite = pgTable(
  'space_invite',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => space.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    // sha256 of the raw token. The raw token is never stored.
    tokenHash: text('token_hash').notNull(),
    role: text('role').$type<'owner' | 'member'>().default('member').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    // Who sent it. Set null if that account is ever deleted — an invite is not
    // worth cascading away, and the email is all that is still needed.
    invitedByUserId: text('invited_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('space_invite_space_idx').on(t.spaceId),
    index('space_invite_email_idx').on(t.email),
    // One live invite per address per space. Re-inviting an address that already
    // has a pending invite rotates it instead of stacking up near-duplicates,
    // so the recipient cannot hold several valid links for the same household.
    uniqueIndex('space_invite_live_uq')
      .on(t.spaceId, t.email)
      .where(sql`${t.acceptedAt} is null`),
  ],
)

// ── relations ─────────────────────────────────────────────────────────────

export const spaceRelations = relations(space, ({ many, one }) => ({
  members: many(spaceMember),
  categories: many(category),
  expenses: many(expense),
  invites: many(spaceInvite),
  createdBy: one(user, {
    fields: [space.createdByUserId],
    references: [user.id],
  }),
}))

export const spaceMemberRelations = relations(spaceMember, ({ one, many }) => ({
  space: one(space, { fields: [spaceMember.spaceId], references: [space.id] }),
  user: one(user, { fields: [spaceMember.userId], references: [user.id] }),
  personalCategories: many(category, { relationName: 'personal_categories' }),
  splits: many(expenseSplit),
}))

export const categoryRelations = relations(category, ({ one, many }) => ({
  space: one(space, { fields: [category.spaceId], references: [space.id] }),
  owner: one(spaceMember, {
    relationName: 'personal_categories',
    fields: [category.ownerMemberId],
    references: [spaceMember.id],
  }),
  expenses: many(expense),
}))

export const expenseRelations = relations(expense, ({ one, many }) => ({
  space: one(space, { fields: [expense.spaceId], references: [space.id] }),
  category: one(category, {
    fields: [expense.categoryId],
    references: [category.id],
  }),
  paidBy: one(spaceMember, {
    fields: [expense.paidByMemberId],
    references: [spaceMember.id],
    relationName: 'paid_expenses',
  }),
  splits: many(expenseSplit),
}))

export const expenseSplitRelations = relations(expenseSplit, ({ one }) => ({
  expense: one(expense, {
    fields: [expenseSplit.expenseId],
    references: [expense.id],
  }),
  member: one(spaceMember, {
    fields: [expenseSplit.memberId],
    references: [spaceMember.id],
  }),
}))

export const spaceInviteRelations = relations(spaceInvite, ({ one }) => ({
  space: one(space, {
    fields: [spaceInvite.spaceId],
    references: [space.id],
  }),
}))

// ── inferred types ────────────────────────────────────────────────────────

export type Space = typeof space.$inferSelect
export type SpaceMember = typeof spaceMember.$inferSelect
export type Category = typeof category.$inferSelect
export type Expense = typeof expense.$inferSelect
export type ExpenseSplit = typeof expenseSplit.$inferSelect
export type SpaceInvite = typeof spaceInvite.$inferSelect
