/**
 * Input validation for every server function.
 *
 * Validators run before the handler, so a malformed request never reaches the
 * database. Money arrives as a decimal string and is converted to integer
 * minor units here — no float ever crosses the boundary.
 */
import { z } from 'zod'

import {
  BP_TOTAL,
  MAX_AMOUNT_MINOR,
  formatMinor,
  isAmountTooLarge,
} from './money'
import { CATEGORY_ICON_NAMES } from './category-icons'
import { AVATAR_KEYS } from './avatars'

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO code')

/**
 * A positive decimal amount string like "12.34", capped at ten million.
 *
 * The cap is stated as a message rather than as a bare refusal, because the
 * commonest way to hit it is a units mistake — pasting a total in cents, or a
 * zero key held down — and "amount must be 9999999.99 or less" is the thing
 * somebody can act on. It mirrors MAX_AMOUNT_MINOR, which is where the real
 * enforcement lives; this exists so the person finds out in the field rather than
 * as a 500 from the write.
 */
export const amountStringSchema = z
  .string()
  .trim()
  .regex(/^\d+([.,]\d{1,2})?$/, 'enter an amount like 12.34')
  .refine((s) => Number(s.replace(',', '.')) > 0, 'amount must be above zero')
  // `isAmountTooLarge` rather than `parseAmountToMinor`: zod runs every chained
  // refinement even after an earlier one has failed, so a negative or a
  // malformed amount reached the parser and came back as a thrown RangeError
  // instead of a validation result. A validator that throws on the inputs it is
  // supposed to reject is a 500 with a stack trace where a field error belongs.
  .refine(
    (s) => !isAmountTooLarge(s),
    `amount must be ${formatMinor(MAX_AMOUNT_MINOR)} or less`,
  )

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  // reject 2026-02-31 and friends: round-trip through Date and compare
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number)
    const dt = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1)
    return (
      dt.getFullYear() === y &&
      dt.getMonth() === (m ?? 1) - 1 &&
      dt.getDate() === d
    )
  }, 'not a real calendar date')

export const uuidSchema = z.uuid()

const swatchKeySchema = z.string().min(1).max(40)

export const memberInputSchema = z.object({
  spaceId: uuidSchema,
  displayName: z.string().trim().min(1, 'name is required').max(60),
  color: swatchKeySchema,
  defaultWeightBp: z.number().int().min(0).max(BP_TOTAL).default(0),
})
export type MemberInput = z.infer<typeof memberInputSchema>

/**
 * An avatar key, or null for "derive an identicon from the id".
 *
 * `null` is meaningful and stored as SQL NULL rather than as a sentinel string:
 * a space created before avatars existed should render a generated mark, not
 * look like it failed to load one.
 */
export const avatarKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  // Refuses anything not in the curated set. The value is rendered as a
  // component, so an unrecognised key would be a blank circle.
  .refine((k) => AVATAR_KEYS.includes(k), 'Unknown avatar')
  .nullable()

export const categoryInputSchema = z
  .object({
    spaceId: uuidSchema,
    name: z.string().trim().min(1, 'name is required').max(60),
    color: swatchKeySchema,
    // A closed set, not free text. The name is rendered as a lucide component,
    // so an unrecognised value would render a blank box in the category list —
    // and an arbitrary string from the client is not something to store.
    icon: z.enum(CATEGORY_ICON_NAMES).default('receipt'),
    scope: z.enum(['shared', 'personal']).default('shared'),
    ownerMemberId: uuidSchema.nullable().default(null),
    sortOrder: z.number().int().default(0),
  })
  .refine(
    // Mirrors the category_scope_owner_ck check constraint: a personal category
    // must name its owner, a shared one must not. Catching it here gives a
    // field-level error instead of a 500.
    (v) =>
      (v.scope === 'shared' && v.ownerMemberId === null) ||
      (v.scope === 'personal' && v.ownerMemberId !== null),
    { message: 'a personal category needs an owner', path: ['ownerMemberId'] },
  )
export type CategoryInput = z.infer<typeof categoryInputSchema>

/**
 * Update schemas are written out explicitly rather than derived with
 * `.partial()`.
 *
 * Two reasons, both of which bit in practice:
 *  · Zod 4 refuses `.partial()` on an object that carries a `.refine()`, and
 *    categoryInputSchema does.
 *  · `.partial()` would also make the *identifiers* optional, so
 *    `eq(spaceMember.spaceId, data.spaceId)` would not typecheck — and
 *    allowing a missing spaceId in an authorisation filter is exactly the sort
 *    of hole worth closing by construction.
 *
 * Category scope and owner are deliberately not updatable: a category's scope
 * is fixed at creation, and changing it would silently invalidate the
 * category_scope_owner_ck check constraint.
 */
export const memberUpdateSchema = z.object({
  spaceId: uuidSchema,
  memberId: uuidSchema,
  displayName: z.string().trim().min(1).max(60).optional(),
  color: swatchKeySchema.optional(),
  defaultWeightBp: z.number().int().min(0).max(BP_TOTAL).optional(),
})

export const categoryUpdateSchema = z.object({
  spaceId: uuidSchema,
  categoryId: uuidSchema,
  name: z.string().trim().min(1).max(60).optional(),
  color: swatchKeySchema.optional(),
  icon: z.enum(CATEGORY_ICON_NAMES).optional(),
  sortOrder: z.number().int().optional(),
})

export const splitInputSchema = z.object({
  memberId: uuidSchema,
  weightBp: z.number().int().min(0).max(BP_TOTAL),
})
export type SplitInput = z.infer<typeof splitInputSchema>

export const expenseInputSchema = z
  .object({
    spaceId: uuidSchema,
    amount: amountStringSchema,
    categoryId: uuidSchema.nullable().default(null),
    paidByMemberId: uuidSchema,
    spentOn: isoDateSchema,
    purpose: z.string().trim().min(1, 'say what it was for').max(200),
    note: z.string().trim().max(500).nullable().default(null),
    splits: z.array(splitInputSchema).max(50).default([]),
  })
  .refine((v) => v.splits.length === 0 || v.splits.length > 0, {
    message: 'splits must be empty (single payer) or non-empty',
  })
export type ExpenseInput = z.infer<typeof expenseInputSchema>

export const periodFilterSchema = z.object({
  spaceId: uuidSchema,
  from: isoDateSchema.nullable().default(null),
  to: isoDateSchema.nullable().default(null),
  categoryIds: z.array(uuidSchema).max(200).optional(),
  memberId: uuidSchema.nullable().optional(),
})
export type PeriodFilter = z.infer<typeof periodFilterSchema>
