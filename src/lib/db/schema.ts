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
     * The series this entry was generated by, or null for a hand-typed expense.
     * `set null` on delete so entries outlive their template — the ledger is the
     * record, the template is only a way of making entries.
     */
    recurringId: uuid('recurring_id').references(() => recurringExpense.id, {
      onDelete: 'set null',
    }),
    /**
     * Which occurrence of that series this is: '2026-10' monthly, '2026-W40'
     * weekly. Null for a hand-typed entry.
     *
     * This pair with `recurringId` is what makes catch-up safe. Materialisation
     * runs on every read, and without a uniqueness guarantee two requests racing
     * would both see the month as missing and both create it — so the rent would
     * double the first time two tabs were open. The unique index is the fix, not
     * the careful ordering of the code.
     */
    periodKey: text('period_key'),
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
    /**
     * One entry per occurrence, forever. This is the whole idempotency story for
     * catch-up generation: materialisation may run on every read, from two tabs at
     * once, and the database is what refuses the second insert. Postgres treats
     * NULLs as distinct in a unique index, so hand-typed expenses — which have no
     * series and no key — are unaffected.
     */
    uniqueIndex('expense_recurring_period_uq').on(t.recurringId, t.periodKey),
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

/**
 * A payment between two people that actually happened.
 *
 * Balances has always ended with a settlement plan — "Sam owes Alex €12.40" — and
 * there has never been anywhere to put the fact that it was paid. So the plan was
 * advice that could not be cleared, and advice you cannot clear is advice people
 * stop reading: the same rows came back every month whatever anybody did.
 *
 * A row here is taken off the nets when balances are computed (the payer's net
 * rises by it, the receiver's falls), which is what lets the plan clear itself.
 *
 * Deliberately NOT an expense, and that is the load-bearing part. No category, no
 * split, and it never reaches total spend or the category donut. Moving money
 * between two people who already share a ledger is not spending, and counting it
 * as such would inflate the month by exactly the amount that was settled — the
 * whole month's total paid twice.
 */
export const settlement = pgTable(
  'settlement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => space.id, { onDelete: 'cascade' }),
    /**
     * `restrict`, not `set null`, matching `expense.paidByMemberId`: a payment
     * between two specific people cannot survive one of them being erased, and
     * members are archived rather than deleted, so this never fires in normal
     * use. It fires only if somebody tries to hard-delete a member who has
     * history, which is exactly when it should.
     */
    fromMemberId: uuid('from_member_id')
      .notNull()
      .references(() => spaceMember.id, { onDelete: 'restrict' }),
    toMemberId: uuid('to_member_id')
      .notNull()
      .references(() => spaceMember.id, { onDelete: 'restrict' }),
    amountMinor: integer('amount_minor').notNull(),
    /** The day the money moved, not the day it was typed in. */
    settledOn: date('settled_on').notNull(),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // The read is "this household, this range, newest first", so the index
    // carries both columns in that order.
    index('settlement_space_date_idx').on(t.spaceId, t.settledOn.desc()),
    check('settlement_amount_positive', sql`${t.amountMinor} > 0`),
    // Paying yourself is not a payment. Refused in the column rather than only in
    // the request validator, for the same reason as the amount ceiling: this is
    // the check that holds if the write arrives from somewhere else.
    check(
      'settlement_distinct_members',
      sql`${t.fromMemberId} <> ${t.toMemberId}`,
    ),
  ],
)

/**
 * A repeating expense: the rent, the internet bill, the cleaner.
 *
 * This is a TEMPLATE, not a ledger line. It holds what stays the same — what it
 * is for, how much, who pays, how the cost is shared — and every time an
 * occurrence is due it produces an ordinary expense that is then entirely
 * independent. Editing a generated rent does not change the series, and stopping
 * the series does not touch anything already generated. A template that owned its
 * entries would make correcting one month's amount a decision about every future
 * month, which is exactly backwards: people correct one month because the others
 * are right.
 *
 * HOW OCCURRENCES GET MADE: on read, not on a schedule. There is no cron here and
 * there is one replica, so `materialiseRecurring` runs before the ledger is
 * listed and creates whatever is due. Two consequences, both deliberate:
 *
 *   - It cannot miss a beat because the container happened to be down on the 1st.
 *     The next read catches up, however long it has been.
 *   - It is idempotent by construction, not by care. `expense` carries a unique
 *     index on (recurring_id, period_key), so a second attempt at the same month
 *     inserts nothing. A read that writes is a smell, and the smell is bought
 *     knowingly: the alternative is a scheduler that is wrong whenever it is not
 *     running.
 */
export const recurringExpense = pgTable(
  'recurring_expense',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => space.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    /**
     * `set null` rather than `restrict`, unlike `expense.categoryId`. Archiving a
     * category must not silently kill a rent series — the series is about the
     * money, and it keeps running uncategorised.
     */
    categoryId: uuid('category_id').references(() => category.id, {
      onDelete: 'set null',
    }),
    paidByMemberId: uuid('paid_by_member_id')
      .notNull()
      .references(() => spaceMember.id, { onDelete: 'restrict' }),
    frequency: text('frequency').$type<'monthly' | 'weekly'>().notNull(),
    /**
     * Day of the month the series is anchored to, 1-31.
     *
     * Stored rather than derived from the cursor, because the cursor gets clamped:
     * a series started on the 31st produces Feb 28, and stepping "one month" from
     * Feb 28 would then produce Mar 28 and stay wrong forever. The anchor is what
     * makes the 31st mean the 31st again in March.
     *
     * Ignored for weekly, which has no clamping problem.
     */
    anchorDay: integer('anchor_day').notNull(),
    /** The first occurrence, for display and for "since when". */
    startsOn: date('starts_on').notNull(),
    /**
     * The next occurrence to create. Advances as they are made, so a long-running
     * series does not re-scan from its start on every read.
     */
    nextDueOn: date('next_due_on').notNull(),
    /**
     * Whether generated entries start locked. True, matching a hand-typed
     * expense: rent is the entry most worth protecting from a stray edit.
     */
    locked: boolean('locked').default(true).notNull(),
    /** Stopping the series. `archivedAt` rather than a delete, so history stays. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
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
    // The read is "this household's live series that are due", so the index
    // carries the space, the due date, and excludes the stopped ones. A partial
    // index rather than a plain one because a stopped series is never asked
    // about again.
    index('recurring_expense_due_idx')
      .on(t.spaceId, t.nextDueOn)
      .where(sql`${t.archivedAt} is null`),
    check('recurring_expense_amount_positive', sql`${t.amountMinor} > 0`),
    check(
      'recurring_expense_frequency',
      sql`${t.frequency} in ('monthly', 'weekly')`,
    ),
    check('recurring_expense_anchor_day', sql`${t.anchorDay} between 1 and 31`),
  ],
)

/**
 * How a series divides its cost. The same shape as `expense_split` minus the
 * derived cents, because a template has no amount to derive them from until an
 * occurrence exists.
 *
 * Relational rather than a JSON blob on the template, for the same reason the
 * splits are relational everywhere else: a member who leaves has to keep their
 * name on history, and `restrict` here is what stops a series silently losing a
 * participant.
 */
export const recurringExpenseSplit = pgTable(
  'recurring_expense_split',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recurringId: uuid('recurring_id')
      .notNull()
      .references(() => recurringExpense.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => spaceMember.id, { onDelete: 'restrict' }),
    weightBp: integer('weight_bp').notNull(),
  },
  (t) => [
    uniqueIndex('recurring_expense_split_uq').on(t.recurringId, t.memberId),
    check(
      'recurring_expense_split_weight_range',
      sql`${t.weightBp} between 1 and ${bpTotal}`,
    ),
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
