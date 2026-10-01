/**
 * Creating an expense, including the split editor.
 *
 * The live euro preview is the part worth testing: the plan requires that
 * "Vater: €40.00" is shown while dragging so the rounding is visible and
 * trustworthy rather than something to verify after saving.
 */
import { expect, test } from '@playwright/test'

test.describe('split editor', () => {
  test('shows a live euro preview that changes as weights change', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')

    await page.getByRole('button', { name: 'New expense' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    await page.getByLabel('Amount').fill('100.00')
    await page.getByLabel('What was it for').fill('E2E split check')
    await page.getByLabel('Paid by').selectOption({ label: 'Vale' })

    await page.getByRole('switch', { name: /Split between members/ }).click()

    // With three members, defaults come from each member's defaultWeightBp.
    // The status must state the truth about the remainder rather than
    // silently renormalising the weights.
    await expect(page.getByRole('status')).toBeVisible()

    await page.getByLabel('Vale percent').fill('60')
    await page.getByLabel('Vater percent').fill('30')

    // 60 + 30 leaves 10% unassigned, and it must say so.
    await expect(page.getByRole('status')).toHaveText('10% left to assign')

    await page.getByLabel('Mila percent').fill('10')
    await expect(page.getByRole('status')).toHaveText('Totals 100%')

    // The previews are the money each person is charged.
    await expect(sheet.getByText('€60.00')).toBeVisible()
    await expect(sheet.getByText('€30.00')).toBeVisible()
    await expect(sheet.getByText('€10.00')).toBeVisible()

    // Over-assigning is reported, not clamped.
    await page.getByLabel('Mila percent').fill('20')
    await expect(page.getByRole('status')).toHaveText('10% over-assigned')
  })

  test('rejects weights that do not total 100%', async ({ page }) => {
    await page.goto('/dashboard?period=all')
    await page.getByRole('button', { name: 'New expense' }).click()

    await page.getByLabel('Amount').fill('50.00')
    await page.getByLabel('What was it for').fill('E2E unbalanced')
    await page.getByLabel('Paid by').selectOption({ label: 'Vale' })
    await page.getByRole('switch', { name: /Split between members/ }).click()

    await page.getByLabel('Vale percent').fill('60')
    await page.getByLabel('Vater percent').fill('30')
    await page.getByLabel('Mila percent').fill('0')

    // The save button is disabled while the split does not add up, so an
    // invalid split can never reach the server.
    await expect(
      page.getByRole('button', { name: 'Save expense' }),
    ).toBeDisabled()
  })

  test('the equal preset produces an exact 100%', async ({ page }) => {
    await page.goto('/dashboard?period=all')
    await page.getByRole('button', { name: 'New expense' }).click()

    await page.getByLabel('Amount').fill('10.00')
    await page.getByLabel('What was it for').fill('E2E equal preset')
    await page.getByLabel('Paid by').selectOption({ label: 'Vale' })
    await page.getByRole('switch', { name: /Split between members/ }).click()

    // Three members at 10000/3 is 3333.33 — the preset must give the
    // remainder to one member so the total is exact.
    await page.getByRole('button', { name: 'Equal' }).click()
    await expect(page.getByRole('status')).toHaveText('Totals 100%')
  })

  test('refuses an amount with more than two decimal places', async ({ page }) => {
    await page.goto('/dashboard?period=all')
    await page.getByRole('button', { name: 'New expense' }).click()

    const amount = page.getByLabel('Amount')
    await amount.fill('12.345')

    // aria-invalid marks the field; the client will not parse it as cents.
    await expect(amount).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('button', { name: 'Save expense' })).toBeDisabled()
  })
})
