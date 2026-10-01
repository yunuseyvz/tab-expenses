/**
 * The login screen, driven as a user would.
 *
 * One test, one OTP request. Better Auth rate-limits the OTP endpoints to 3
 * requests per 60 seconds, which is correct for production, so the suite works
 * within the limit rather than disabling the protection.
 */
import { expect, test } from '@playwright/test'

import { requestOtp } from './helpers'

const EMAIL = 'e2e-login@splitwise.local'

test('refuses a wrong code, then accepts the right one', async ({ page }) => {
  await page.goto('/login')

  // The server-rendered page must be usable before any JS runs.
  await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible()

  await page.getByLabel('Email').fill(EMAIL)
  await page.getByRole('button', { name: 'Send code' }).click()

  // Six separate inputs, so backspace and screen readers behave.
  await expect(page.getByLabel('Digit 1')).toBeVisible()
  const code = await requestOtp(EMAIL)

  // A resend cooldown is shown, so the user is not left hammering the button.
  await expect(page.getByRole('button', { name: /Resend code in/ })).toBeVisible()

  // ── a wrong code must be refused ──────────────────────────────────────
  const wrong = code === '000000' ? '111111' : '000000'
  await page.getByLabel('Digit 1').fill(wrong)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Still on /login, with an error the user can read.
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('alert')).toBeVisible()
  // And the boxes are reset, ready for another attempt.
  await expect(page.getByLabel('Digit 1')).toHaveValue('')

  // ── the right code must be accepted ───────────────────────────────────
  // The whole code arrives in one input event, the way mobile OTP autofill and
  // password managers deliver it. All six boxes must fill.
  await page.getByLabel('Digit 1').fill(code)
  for (const [i, d] of code.split('').entries()) {
    await expect(page.getByLabel(`Digit ${i + 1}`)).toHaveValue(d)
  }

  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)

  // A brand-new user has no space, so onboarding catches them rather than
  // dropping them into an empty dashboard.
  await expect(page.getByText('Set up your ledger')).toBeVisible()
})
