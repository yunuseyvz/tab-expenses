/**
 * The flows a real user actually performs, driven through a phone-sized
 * viewport because that is the entry point for this app.
 */
import { expect, test } from '@playwright/test'

import { chooseOption } from './helpers'

test.describe('ledger', () => {
  // These run against the session established in global-setup.
  test('shows the seeded dashboard totals', async ({ page }) => {
    await page.goto('/dashboard?period=all')

    await expect(page.getByRole('heading', { name: 'Flat 3B' })).toBeVisible()
    await expect(page.getByText('Total spend')).toBeVisible()
    await expect(page.getByText('Your share')).toBeVisible()
  })

  test('the ledger lists the seeded expenses grouped by day', async ({
    page,
  }) => {
    await page.goto('/expenses?period=all')

    await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible()
    await expect(page.getByText('Weekly groceries')).toBeVisible()
    await expect(page.getByText('Electricity')).toBeVisible()
    // A split expense is labelled, so the split is visible without opening it.
    await expect(page.getByText(/split \d+ ways/).first()).toBeVisible()
  })

  test('the category filter narrows the total in one pass', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')

    // By class, and that is worth saying: the assertion is about arithmetic,
    // not about the figure's typeface, and it has already broken once when the
    // amounts moved off the wordmark's serif. `tnum` matters — it is what keeps
    // the digits the same width, so the text content is the real figure and not
    // something reflowed.
    const total = page.locator('p.tnum.text-3xl').first()
    await expect(total).toHaveText(/€[\d.,]+/)
    const before = await total.textContent()

    // Deselect everything: an explicit empty selection must show a zero total,
    // not fall back to the unfiltered one.
    await page.getByRole('button', { name: 'None' }).click()
    await expect(page).toHaveURL(/cats=/)
    await expect(total).toHaveText(/0[,.]00/)

    // Then pick a single category.
    await page.getByRole('button', { name: /Groceries/ }).click()
    await expect(total).toHaveText(/€[\d.,]+/)
    const after = await total.textContent()
    expect(after).not.toBe(before)
  })

  test('"All" restores the unfiltered total', async ({ page }) => {
    await page.goto('/dashboard?period=all')
    const total = page.locator('p.tnum.text-3xl').first()
    await expect(total).toHaveText(/€[\d.,]+/)
    const before = await total.textContent()

    await page.getByRole('button', { name: 'None' }).click()
    await expect(total).toHaveText(/0[,.]00/)

    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(total).toHaveText(before ?? '')
  })

  test('balances name who owes whom, including virtual members', async ({
    page,
  }) => {
    await page.goto('/balances?period=all')

    await expect(page.getByRole('heading', { name: 'Balances' })).toBeVisible()
    await expect(page.getByText('Per member')).toBeVisible()
    // Every member appears in the per-member table, virtual ones included.
    // (Alex also appears in a settlement line, hence .first().)
    await expect(page.getByText('Alex').first()).toBeVisible()
    await expect(page.getByText('Robin').first()).toBeVisible()
  })

  test('creates an expense and it persists across a reload', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')

    await page.getByRole('button', { name: 'New expense' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    const purpose = `E2E save ${Date.now()}`
    await page.getByLabel('Amount').fill('100.00')
    await page.getByLabel('What was it for').fill(purpose)
    await chooseOption(page, page.getByLabel('Paid by'), 'Sam')

    // No split: the payer takes 100% and the save button is immediately live.
    await expect(page.getByRole('status')).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Save expense' }).click()

    // The sheet closes and the new row is in the recent-entries list.
    await expect(sheet).toBeHidden()
    await expect(page.getByText(purpose)).toBeVisible()

    // It survives a reload, so it really was persisted rather than held in
    // client state.
    await page.reload()
    await expect(page.getByText(purpose)).toBeVisible()
  })
})
