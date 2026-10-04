/**
 * Creating an expense, including the split editor.
 *
 * The live euro preview is the part worth testing: the plan requires that
 * "Alex: €40.00" is shown while dragging so the rounding is visible and
 * trustworthy rather than something to verify after saving.
 *
 * These specs describe the editor as it is now — a strip of member chips for "Who
 * paid" and one roster for the split — and they pin the one decision that is easy
 * to get wrong in either direction: rows are INDEPENDENT. Setting a share must
 * move that row and nothing else, because renormalising the rest makes a typed
 * 60/30/10 unreachable. A total that is not 100% is reported and blocks Save,
 * which is visible and has a one-tap way out; a control that rewrites the numbers
 * beside the one you edited is neither.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Choose the payer by clicking the pill, which is what a person does.
 *
 * The radio itself is `sr-only` behind that pill, so `check()` refuses twice over:
 * its hit-target test finds the pill covering it, and its viewport test finds a 1px
 * clipped box. Clicking the enclosing `<label>` is the same gesture the pill makes
 * and dispatches to the radio normally. Nothing about the control is compromised
 * for this — it is one per group, it takes arrow keys, and it is labelled.
 */
const checkPayer = (page: Page, name: string) =>
  page
    .getByRole('radio', { name: `${name} paid` })
    .locator('..')
    .click()

/**
 * No status line when the total is right.
 *
 * The line carries `empty:hidden`, so an empty one is display:none and drops out
 * of the accessibility tree entirely — which is the point of it. `toHaveText('')`
 * would then fail looking for an element that is not there; `toBeHidden()` passes
 * both for an empty line and for no line at all, which is what is being asserted.
 */
const expectNoComplaint = (page: Page) =>
  expect(page.getByRole('status')).toBeHidden()

const pct = (page: Page, name: string) =>
  page.getByLabel(`${name} percent`).inputValue()

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
    // The payer pill is its own choice: picking Sam also ticks him in the split.
    await checkPayer(page, 'Sam')
    await page.getByLabel('Alex is part of this expense').check()
    await page.getByLabel('Robin is part of this expense').check()

    // Ticking re-equalises, so all three start at a third each.
    await expect(page.getByLabel('Sam percent')).toHaveValue('33.3')
    await expect(page.getByLabel('Alex percent')).toHaveValue('33.3')
    await expect(page.getByLabel('Robin percent')).toHaveValue('33.3')

    // Three thirds of €100 is €33.34/€33.33/€33.33 — the previews are the money
    // each person is actually charged, rounding included and visible. Two of the
    // three agree to the cent, so the shared figure is matched twice rather than
    // asserted with a count nobody can read off the screen.
    await expect(sheet.getByText('€33.34')).toBeVisible()
    await expect(sheet.getByText('€33.33')).toHaveCount(2)

    // A typed 60/30/10 lands exactly as typed. This is the assertion that matters
    // most in this file: renormalising the other rows on every edit makes this
    // unreachable, and dinner bills are mostly 60/30/10.
    await page.getByLabel('Sam percent').fill('60')
    await page.getByLabel('Alex percent').fill('30')
    await page.getByLabel('Robin percent').fill('10')
    expect(await pct(page, 'Sam')).toBe('60')
    expect(await pct(page, 'Alex')).toBe('30')
    expect(await pct(page, 'Robin')).toBe('10')

    await expect(sheet.getByText('€60.00')).toBeVisible()
    await expect(sheet.getByText('€30.00')).toBeVisible()
    await expect(sheet.getByText('€10.00')).toBeVisible()

    // Nothing to report: the total is right.
    await expectNoComplaint(page)
  })

  test('moving one share moves only that row', async ({ page }) => {
    await page.goto('/dashboard?period=all')
    await page.getByRole('button', { name: 'New expense' }).click()

    await page.getByLabel('Amount').fill('100.00')
    await page.getByLabel('What was it for').fill('E2E independent')
    await checkPayer(page, 'Sam')
    await page.getByLabel('Alex is part of this expense').check()
    await page.getByLabel('Robin is part of this expense').check()

    const alex = await pct(page, 'Alex')
    const robin = await pct(page, 'Robin')

    await page.getByLabel('Sam percent').fill('60')

    expect(await pct(page, 'Sam')).toBe('60')
    expect(await pct(page, 'Alex')).toBe(alex)
    expect(await pct(page, 'Robin')).toBe(robin)

    // 60 + 33.3 + 33.3 comes to 126.6, so the sheet says so and Save waits. It is
    // a report, not a silent correction: the other two rows still hold exactly
    // what they held, and `26.66%` is the shortfall rather than a rounded shrug.
    await expect(page.getByRole('status')).toContainText('26.66% over-assigned')
    await expect(
      page.getByRole('button', { name: 'Save expense' }),
    ).toBeDisabled()
    expect(await pct(page, 'Alex')).toBe(alex)
  })

  test('reports a total that is not 100% and blocks the save, with a way out', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')
    await page.getByRole('button', { name: 'New expense' }).click()

    await page.getByLabel('Amount').fill('50.00')
    await page.getByLabel('What was it for').fill('E2E unbalanced')
    await checkPayer(page, 'Sam')
    await page.getByLabel('Alex is part of this expense').check()
    await page.getByLabel('Robin is part of this expense').check()

    await page.getByLabel('Sam percent').fill('60')
    await page.getByLabel('Alex percent').fill('30')
    await page.getByLabel('Robin percent').fill('0')
    await expect(page.getByRole('status')).toContainText('10% left to assign')
    await expect(
      page.getByRole('button', { name: 'Save expense' }),
    ).toBeDisabled()

    // The way out is one tap, and it is the `Equal` control that is already there.
    await page.getByRole('button', { name: 'Equal' }).click()
    await expectNoComplaint(page)
    await expect(
      page.getByRole('button', { name: 'Save expense' }),
    ).toBeEnabled()
  })

  test('clamps a percentage outside 0-100 rather than accepting a negative share', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')
    await page.getByRole('button', { name: 'New expense' }).click()

    await page.getByLabel('Amount').fill('50.00')
    await page.getByLabel('What was it for').fill('E2E overtyped')
    await checkPayer(page, 'Sam')
    await page.getByLabel('Alex is part of this expense').check()
    await page.getByLabel('Robin is part of this expense').check()

    // A negative share is impossible, so it clamps at zero and the sheet reports
    // the resulting gap. It does not quietly make up the difference somewhere
    // else, which is exactly what a renormalising control would have done.
    await page.getByLabel('Alex percent').fill('-40')
    expect(await pct(page, 'Alex')).toBe('0')
    await expect(page.getByRole('status')).toContainText('% left to assign')
    await expect(
      page.getByRole('button', { name: 'Save expense' }),
    ).toBeDisabled()

    // And the other way: past 100 clamps at 100 and reports the overshoot.
    await page.getByLabel('Alex percent').fill('400')
    expect(Number(await pct(page, 'Alex'))).toBeLessThanOrEqual(100)
    await expect(page.getByRole('status')).toContainText('over-assigned')
  })

  test('offers exactly one reset, and only when there is something to reset', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')
    await page.getByRole('button', { name: 'New expense' }).click()

    await page.getByLabel('Amount').fill('10.00')
    await page.getByLabel('What was it for').fill('E2E reset')
    await checkPayer(page, 'Sam')

    // One person in: nothing to level, so the header does not offer it. `Everyone`
    // is the one action left, and it is there because somebody is not sharing yet.
    await expect(page.getByRole('button', { name: 'Equal' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Everyone' })).toBeVisible()

    await page.getByRole('button', { name: 'Everyone' }).click()
    await expect(page.getByRole('button', { name: 'Everyone' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Equal' })).toHaveCount(0)
    // Everyone in, evenly: the header states it instead of offering a reset.
    await expect(page.getByText('Split equally')).toBeVisible()

    // Make it uneven and the reset comes back — for levelling, not for adding.
    await page.getByLabel('Sam percent').fill('70')
    await expect(page.getByRole('button', { name: 'Equal' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Everyone' })).toHaveCount(0)

    // Three members at 10000/3 is 3333.33 — levelling must give the remainder to
    // one member so the total is exact.
    await page.getByRole('button', { name: 'Equal' }).click()
    await expect(page.getByText('Split equally')).toBeVisible()
    await expect(page.getByLabel('Sam percent')).toHaveValue('33.3')
  })

  test("hands a departing member's share back in proportion", async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')
    await page.getByRole('button', { name: 'New expense' }).click()

    await page.getByLabel('Amount').fill('100.00')
    await page.getByLabel('What was it for').fill('E2E untick')
    await checkPayer(page, 'Sam')
    await page.getByLabel('Alex is part of this expense').check()
    await page.getByLabel('Robin is part of this expense').check()

    await page.getByLabel('Sam percent').fill('60')
    await page.getByLabel('Alex percent').fill('30')
    await page.getByLabel('Robin percent').fill('10')
    await expectNoComplaint(page)

    // Robin's 10 points are divided between the two who were on 60 and 30, in
    // that ratio: 6.7 and 3.3, landing on 66.7/33.3. Levelling them flat to 50/50
    // would be arithmetically tidier and would throw away the split somebody set
    // on purpose.
    await page.getByLabel('Robin is part of this expense').uncheck()
    await expect(page.getByLabel('Sam percent')).toHaveValue('66.7')
    await expect(page.getByLabel('Alex percent')).toHaveValue('33.3')
    await expectNoComplaint(page)

    // And a row for somebody not sharing shows no share at all.
    await expect(page.getByLabel('Robin percent')).toHaveCount(0)
  })

  test('keeps the payer when they stop sharing', async ({ page }) => {
    await page.goto('/dashboard?period=all')
    await page.getByRole('button', { name: 'New expense' }).click()

    await page.getByLabel('Amount').fill('40.00')
    await page.getByLabel('What was it for').fill('E2E covered a ticket')
    await checkPayer(page, 'Alex')
    await page.getByLabel('Sam is part of this expense').check()
    await page.waitForTimeout(200)
    expect(await pct(page, 'Alex')).toBe('50')

    // Alex is the payer but no longer in it: "I covered your train ticket" is the
    // case the two questions being separate exists for. Paying and sharing are
    // different facts, and unsharing must not unchoose.
    await page.getByLabel('Alex is part of this expense').uncheck()
    await expect(page.getByRole('radio', { name: 'Alex paid' })).toBeChecked()
    await expect(page.getByLabel('Alex percent')).toHaveCount(0)
    await expect(page.getByText('Sam covered all of it')).toBeVisible()
  })

  test('sets the payer from one strip, with one control per person', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')
    await page.getByRole('button', { name: 'New expense' }).click()

    await page.getByLabel('Amount').fill('20.00')
    await page.getByLabel('What was it for').fill('E2E payer strip')

    // The payer is one fieldset of three radios and nothing else, and the split
    // list below it carries ticks only. A payer control repeated on every split
    // row is the shape this replaced, and it was two decisions competing for the
    // same glance.
    const strip = page.getByRole('radiogroup', { name: 'Who paid' })
    await expect(strip.getByRole('radio')).toHaveCount(3)
    const split = page.locator('fieldset', { hasText: 'Split between' })
    await expect(split.getByRole('radio')).toHaveCount(0)

    // One tap, one choice. The real radios underneath keep it single-select.
    await checkPayer(page, 'Alex')
    await expect(page.getByRole('radio', { name: 'Alex paid' })).toBeChecked()
    await checkPayer(page, 'Robin')
    await expect(page.getByRole('radio', { name: 'Robin paid' })).toBeChecked()
    // Single-select within the group, which is what the real radios buy: no
    // handler has to remember to untick the previous one.
    expect(await strip.getByRole('radio', { checked: true }).count()).toBe(1)

    // Choosing a payer ticks them into the split, because somebody who paid for
    // the household is usually sharing it.
    await expect(page.getByLabel('Robin is part of this expense')).toBeChecked()
  })

  test('refuses an amount with more than two decimal places', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')
    await page.getByRole('button', { name: 'New expense' }).click()

    const amount = page.getByLabel('Amount')
    await amount.fill('12.345')

    // aria-invalid marks the field; the client will not parse it as cents.
    await expect(amount).toHaveAttribute('aria-invalid', 'true')
    await expect(
      page.getByRole('button', { name: 'Save expense' }),
    ).toBeDisabled()
  })
})
