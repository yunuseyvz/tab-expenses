/**
 * Recording a payment, and taking it back.
 *
 * The point of the feature is that the settlement plan can be cleared. Balances
 * has suggested payments since it existed, and there was nowhere to say one had
 * happened — so the same rows came back every month whatever anybody did, and a
 * list that never changes is a list people stop reading.
 *
 * These run against the seeded household and put it back as they found it. Each
 * step asserts the thing that would be easy to get subtly wrong: that paying does
 * not change what was spent, only what is owed, and that removing a payment
 * restores the debt exactly rather than approximately.
 *
 * Assertions are on state rather than on toasts. Toasts stack, so a locator for
 * them matches more than one the moment two land together, and a test that breaks
 * because two confirmations were on screen at once is testing the notifier.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const settleCard = (page: Page) =>
  page.locator('.card', { hasText: 'Settle up' }).first()
const memberCard = (page: Page) =>
  page.locator('.card', { hasText: 'Per member' }).first()
const recordedCard = (page: Page) =>
  page.locator('.card', { hasText: 'Recorded payments' })
const markPaid = (page: Page) =>
  settleCard(page).getByRole('button', { name: 'Mark paid' })
const removeButtons = (page: Page) =>
  recordedCard(page).getByRole('button', { name: /^Remove payment from/ })

/** Undo everything this spec recorded, whether it passed or not. */
async function removeEverythingRecorded(page: Page) {
  let guard = 0
  while ((await removeButtons(page).count()) > 0 && guard++ < 15) {
    const before = await removeButtons(page).count()
    await removeButtons(page).first().click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Remove payment' })
      .click()
    await expect(removeButtons(page)).toHaveCount(before - 1)
  }
}

test.describe('settlements', () => {
  test('a suggested payment can be recorded and taken back', async ({
    page,
  }) => {
    // All time, so the plan has something in it whatever the seed dates are and
    // whatever month the suite happens to run in.
    await page.goto('/balances?period=all')
    await expect(settleCard(page)).toBeVisible()

    const linesBefore = await markPaid(page).count()
    test.skip(linesBefore === 0, 'seeded household is already square')

    // paid and share are facts and must not move. Only what is owed moves.
    const spentBefore = await memberCard(page).innerText()
    const planBefore = await settleCard(page).innerText()

    await markPaid(page).first().click()

    try {
      // The suggested line is gone, because the debt behind it is gone.
      await expect(markPaid(page)).toHaveCount(linesBefore - 1)

      // It is in the record now, with a way to remove it.
      await expect(recordedCard(page)).toBeVisible()
      await expect(removeButtons(page)).toHaveCount(1)

      const spentAfter = await memberCard(page).innerText()
      const paidLines = (s: string) =>
        s.split('\n').filter((l) => l.startsWith('paid '))
      expect(paidLines(spentAfter)).toEqual(paidLines(spentBefore))
      expect(spentAfter).not.toBe(spentBefore)

      // Removing asks first, and the question says what actually happens —
      // which for a payment is the reverse of the usual reassurance.
      await removeButtons(page).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading')).toHaveText(
        'Remove this payment?',
      )
      await expect(dialog).toContainText('The debt it cleared comes back')

      await dialog.getByRole('button', { name: 'Remove payment' }).click()
      await expect(recordedCard(page)).toHaveCount(0)

      // Exactly as it was, not merely similar: the same plan lines with the same
      // amounts, and the per-member figures matching line for line.
      await expect(markPaid(page)).toHaveCount(linesBefore)
      await expect.poll(() => settleCard(page).innerText()).toBe(planBefore)
      await expect.poll(() => memberCard(page).innerText()).toBe(spentBefore)
    } finally {
      // If an assertion above failed mid-way the payment is still recorded, and
      // leaving it would corrupt every later test that reads balances.
      await removeEverythingRecorded(page)
    }
  })

  test('the plan empty state is a state, not a sentence', async ({ page }) => {
    await page.goto('/balances?period=all')
    await expect(settleCard(page)).toBeVisible()

    try {
      // Pay every suggested line, then read the state it lands in. Waiting for
      // the count to fall after each click is what keeps the loop from firing the
      // next one at a list that has not re-rendered.
      let guard = 0
      while ((await markPaid(page).count()) > 0 && guard++ < 12) {
        const before = await markPaid(page).count()
        await markPaid(page).first().click()
        await expect(markPaid(page)).toHaveCount(before - 1)
      }

      await expect(settleCard(page)).toContainText('All square')
      await expect(settleCard(page)).toContainText('Nobody owes anybody')
      await expect(markPaid(page)).toHaveCount(0)
      // Every recorded payment is still listed, so "all square" cannot be
      // reached by quietly dropping rows.
      expect(await removeButtons(page).count()).toBeGreaterThan(0)
    } finally {
      await removeEverythingRecorded(page)
    }
  })
})
