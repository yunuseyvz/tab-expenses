/**
 * The flows a real user actually performs, driven through a phone-sized
 * viewport because that is the entry point for this app.
 */
import { expect, test } from '@playwright/test'

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
    // The payer radio sits behind its pill, so click the pill the way a person
    // does — see the note on checkPayer in split.spec.ts.
    await page.getByRole('radio', { name: 'Sam paid' }).locator('..').click()

    // No split: picking the payer ticks him alone at 100%, so the save button
    // is immediately live.
    await expect(page.getByRole('status')).toHaveText('Sam covered all of it')
    await sheet.getByRole('button', { name: 'Save expense' }).click()

    // The sheet closes and the new row is in the recent-entries list.
    await expect(sheet).toBeHidden()
    await expect(page.getByText(purpose)).toBeVisible()

    // It survives a reload, so it really was persisted rather than held in
    // client state.
    await page.reload()
    await expect(page.getByText(purpose)).toBeVisible()
  })

  test('the lock is a labelled badge that says which way it is set', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')
    await page.getByRole('button', { name: 'New expense' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    // A new entry starts locked — the author decides whether the household may
    // change it — and the corner says so in words. An unlabelled padlock was
    // the problem: at 17px the two glyphs are near identical, so a toggle
    // reading only as an icon told you neither what it controlled nor which way
    // it was set.
    //
    // Named by its visible word rather than an aria-label. The label used to
    // name the action while the badge named the state, so a screen reader heard
    // "Unlock this expense" for a chip visibly reading Locked.
    const lock = sheet.getByRole('button', { name: 'Locked', exact: true })
    await expect(lock).toBeVisible()
    await expect(lock).toHaveAttribute('aria-pressed', 'true')

    await lock.click()
    const unlocked = sheet.getByRole('button', {
      name: 'Unlocked',
      exact: true,
    })
    await expect(unlocked).toBeVisible()
    await expect(unlocked).toHaveAttribute('aria-pressed', 'false')

    // Still one control, and still in the header rather than in the form.
    await expect(
      sheet.getByRole('button', { name: /^(Locked|Unlocked)$/ }),
    ).toHaveCount(1)
  })

  test("an edit sheet ends with the entry's own record, under a rule", async ({
    page,
  }) => {
    await page.goto('/expenses')
    const row = page.locator('main button[aria-label^="Edit "]').first()
    await row.waitFor({ state: 'visible' })
    await row.click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    // Who added it and when, split off from the fields above by its own border.
    // It is not part of the form: the form stops, and this is the entry's own
    // record, with a different date from any in the notes above it.
    const provenance = sheet.locator('form > p').last()
    await expect(provenance).toContainText(/Added by .+/)

    const rule = await provenance.evaluate((el) => {
      const styles = getComputedStyle(el)
      return {
        borderTopWidth: styles.borderTopWidth,
        paddingTop: Number.parseFloat(styles.paddingTop),
      }
    })
    expect(rule.borderTopWidth).toBe('1px')
    expect(rule.paddingTop).toBeGreaterThan(0)

    // And it is the last thing in the form, so it reads as a footer rather than
    // as a line that happened to land there.
    const isLast = await provenance.evaluate(
      (el) => el === el.parentElement?.lastElementChild,
    )
    expect(isLast).toBe(true)
  })
})
