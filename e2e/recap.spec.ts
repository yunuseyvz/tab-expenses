/**
 * The month in review.
 *
 * Two things worth pinning here, and neither is the presence of a card.
 *
 * The first is that it is absent for "All time". A recap of everything is not a
 * recap, and a card of all-time figures sitting under a heading about a month
 * would be wrong in a way that looks fine.
 *
 * The second is the comparison window, which is the part that would silently lie.
 * "This month" resolves to the whole calendar month, so a recap opened on the 4th
 * would compare four days of October against all of September and report a
 * collapse in spending. The label has to say which comparison it made, and that
 * is what is asserted: a month in progress never claims "vs last month".
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const recap = (page: Page) =>
  page.locator('.card', { hasText: 'Month in review' }).first()

test.describe('month in review', () => {
  test('appears for a bounded period, and not for all time', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')
    await expect(
      page.locator('.card', { hasText: 'Month in review' }),
    ).toHaveCount(0)

    await page.goto('/dashboard?period=lastMonth')
    const card = recap(page)
    await expect(card).toBeVisible()

    // A total, how many entries made it, and the three highlights. Asserted as
    // "there is one of each" rather than against the seeded figures, which are
    // the ledger's business and not this card's.
    await expect(card).toContainText('€')
    await expect(card).toContainText(/\d+ entr/)
    await expect(card).toContainText('Biggest')
    await expect(card).toContainText('Paid the most')
  })

  test('a month in progress never compares against a whole last month', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=thisMonth')
    const card = recap(page)
    await expect(card).toBeVisible()

    const text = await card.innerText()
    // The whole point: four days of October against four days of September, not
    // against September. If this ever says "vs last month" for the current
    // month, the number it shows is not the number it claims.
    expect(text).not.toContain('vs last month')
    expect(text).toMatch(
      /vs this point last month|nothing by this point last month/,
    )
  })

  test('a finished month compares against the whole month before it', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=lastMonth')
    const card = recap(page)
    await expect(card).toBeVisible()
    const text = await card.innerText()
    // Either a percentage against the whole previous month, or a plain statement
    // that there was nothing in it. Never the part-month wording, which would
    // mean the window had been clamped by today for a month that is already over.
    expect(text).toMatch(/vs last month|nothing at all last month/)
    expect(text).not.toContain('this point last month')
  })
})
