/**
 * Registration, sign-in and onboarding, as a user actually experiences them.
 *
 * Deliberately one test. Better Auth rate-limits both OTP endpoints to 3
 * requests per 60 seconds, so every extra sign-in spends shared budget and
 * makes the suite order-dependent. Two sign-ins for the whole run (this one and
 * the global setup) sits inside the limit with room to spare. The protection
 * stays on; the suite simply does not fight it.
 *
 * This file also opts out of the suite's shared authenticated session, because
 * it is the case that session cannot cover: no user, no space, no cookie.
 */
import { expect, test } from '@playwright/test'

import { chooseOption, waitForOtp } from './helpers'

test.use({ storageState: { cookies: [], origins: [] } })

// Waiting out a rate limit can legitimately take minutes.
test.setTimeout(300_000)

test('a wrong code is refused, the right one works, and onboarding follows', async ({
  page,
}) => {
  // ── the login screen ─────────────────────────────────────────────────
  // Unauthenticated: /dashboard redirects to /login with the intended
  // destination preserved, so sign-in can return here.
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?redirect=/)

  // The server-rendered page must be usable before any JS runs.
  await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible()

  // A login cannot create an account, so a new address has to register first.
  // This is the guard for that: the form offers registration, and the code
  // below is only ever sent to an address that already has a user row.
  await expect(page.getByRole('link', { name: 'Create one' })).toBeVisible()
  await page.getByRole('link', { name: 'Create one' }).click()
  await expect(page).toHaveURL(/\/register/)

  const email = `e2e-${Date.now()}@tab.local`
  await page.getByLabel('Your name').fill('E2E Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send code' }).click()

  // Six separate inputs, so backspace and screen readers behave.
  const digit1 = page.getByLabel('Digit 1')
  await digit1.waitFor({ state: 'visible', timeout: 60_000 })
  // A resend cooldown is shown, so the user is not left hammering the button.
  await expect(
    page.getByRole('button', { name: /Resend code in/ }),
  ).toBeVisible()

  // The click above already requested the code; just read it back.
  const code = await waitForOtp(email)

  // ── a wrong code must be refused ──────────────────────────────────────
  const wrong = code === '000000' ? '111111' : '000000'
  await digit1.fill(wrong)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/register/)
  await expect(page.getByRole('alert')).toBeVisible()
  // And the boxes are reset, ready for another attempt.
  await expect(digit1).toHaveValue('')

  // ── the right code must be accepted ───────────────────────────────────
  // The whole code arrives in one input event, the way mobile OTP autofill and
  // password managers deliver it. All six boxes must fill.
  await digit1.fill(code)
  for (const [i, d] of code.split('').entries()) {
    await expect(page.getByLabel(`Digit ${i + 1}`)).toHaveValue(d)
  }

  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).not.toHaveURL(/\/register/, { timeout: 60_000 })

  // ── onboarding ────────────────────────────────────────────────────────
  // A brand-new account has no spaces, so the protected layout redirects to
  // /setup rather than into an empty dashboard.
  await expect(page).toHaveURL(/\/setup/)
  await expect(
    page.getByRole('heading', { name: /Set up your ledger/ }),
  ).toBeVisible()
  await expect(
    page.getByText('One currency per space, so sums are always meaningful.'),
  ).toBeVisible()

  // Both name fields are required, so a space cannot be created unnamed.
  await expect(page.getByLabel('Space name')).toHaveAttribute('required', '')
  await expect(page.getByLabel('Your name in this space')).toHaveAttribute(
    'required',
    '',
  )

  await page.getByLabel('Space name').fill('E2E Household')
  await page.getByLabel('Your name in this space').fill('Tester')
  await chooseOption(page, page.getByLabel('Currency'), 'EUR')
  await page.getByRole('button', { name: 'Create space' }).click()

  // Landed in the new space, with the name from the form. This is the
  // regression guard for the cache race: a stale empty space list made
  // /_protected bounce straight back to /setup, so the user would see the form
  // again with no error.
  await expect(page).toHaveURL(/\/dashboard/)
  await expect(
    page.getByRole('heading', { name: 'E2E Household' }),
  ).toBeVisible()
  await expect(page.getByText('Total spend')).toBeVisible()

  // And it survives a reload, so the space really was persisted.
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'E2E Household' }),
  ).toBeVisible()

  // Signing that account back in later is not re-tested here on purpose: it
  // would need two more OTP calls, pushing the run past Better Auth's 3-per-60s
  // limit on the verify endpoint. global-setup.ts covers it instead by signing
  // in as the seeded account, which was created long before the run started.
})
