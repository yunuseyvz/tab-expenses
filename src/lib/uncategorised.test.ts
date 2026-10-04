/**
 * The Uncategorised pseudo-category's contracts.
 *
 * Three small promises that would each break silently: the input schema must
 * accept the sentinel (it is not a uuid, so a naive uuid array rejects the
 * very filter the chips build), the chip's colour must survive `swatchColor`
 * (which falls back to terracotta for unknown keys), and its icon must resolve
 * (unknown names fall back, but assert it rather than trusting it).
 */
import { describe, expect, it } from 'vitest'

import { UNCATEGORISED_CHIP, UNCATEGORISED_ID } from './uncategorised'
import { periodFilterSchema } from './guards'
import { swatchColor } from './swatches'
import { iconFor } from './category-icons'

describe('uncategorised', () => {
  it('is not a uuid, so it can never collide with a real category', () => {
    expect(UNCATEGORISED_ID).toBe('uncategorised')
    expect(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        UNCATEGORISED_ID,
      ),
    ).toBe(false)
  })

  it('passes the category filter schema alongside real ids', () => {
    const parsed = periodFilterSchema.safeParse({
      spaceId: '123e4567-e89b-12d3-a456-426614174000',
      categoryIds: ['123e4567-e89b-12d3-a456-426614174000', UNCATEGORISED_ID],
    })
    expect(parsed.success).toBe(true)
  })

  it('still rejects garbage in the filter', () => {
    const parsed = periodFilterSchema.safeParse({
      spaceId: '123e4567-e89b-12d3-a456-426614174000',
      categoryIds: ['not-a-category'],
    })
    expect(parsed.success).toBe(false)
  })

  it('keeps its grey through swatchColor', () => {
    // Unknown keys fall back to terracotta — which would paint
    // "Uncategorised" like a real category. Raw CSS passes through instead.
    expect(swatchColor(UNCATEGORISED_CHIP.color)).toBe(UNCATEGORISED_CHIP.color)
    expect(swatchColor('#abc123')).toBe('#abc123')
  })

  it('resolves an icon for the chip', () => {
    expect(() => iconFor(UNCATEGORISED_CHIP.icon)).not.toThrow()
    expect(iconFor(UNCATEGORISED_CHIP.icon)).toBeTruthy()
  })

  it('shapes the chip like a Category, so the chips render it as one', () => {
    expect(UNCATEGORISED_CHIP).toMatchObject({
      id: UNCATEGORISED_ID,
      name: 'Uncategorised',
      scope: 'shared',
    })
  })
})
