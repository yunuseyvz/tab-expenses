/**
 * Shared E2E helpers.
 *
 * Signing in goes through the real OTP flow: request a code, then read it out of
 * Mailpit's HTTP API. No test-only backdoor, so the tests exercise the same
 * path a user does.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025'

/**
 * Better Auth rate-limits the OTP endpoints to 3 requests per 60 seconds —
 * both the send *and* the verify. That is right for production and hostile to a
 * suite that signs in more than once, so rather than switching the protection
 * off these helpers wait the limit out. Tests therefore stay independent of
 * each other and of the order they run in.
 */
const RATE_LIMIT_WAIT = 20_000

async function sendOtp(base: string, email: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(
      `${base}/api/auth/email-otp/send-verification-otp`,
      {
        method: 'POST',
        // Better Auth's CSRF check needs an Origin, exactly as a browser sends.
        headers: {
          'Content-Type': 'application/json',
          Origin: base,
          Referer: `${base}/login`,
        },
        body: JSON.stringify({ email, type: 'sign-in' }),
      },
    )
    if (res.ok) return
    if (res.status !== 429) {
      throw new Error(
        `send-verification-otp failed: ${res.status} ${await res.text()}`,
      )
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_WAIT))
  }
  throw new Error('send-verification-otp stayed rate limited after 5 attempts')
}

/**
 * Read a code that the app has already asked for, by polling Mailpit.
 *
 * Use this whenever the UI already clicked "Send code": the click *is* the
 * request, so asking for a second one here would double the OTP traffic and the
 * UI's own request could get rate-limited — leaving the test stuck on the email
 * step with no code to type.
 */
export async function waitForOtp(email: string): Promise<string> {
  // Delivery is deliberately not awaited by the auth hook, so poll.
  for (let i = 0; i < 60; i++) {
    const messages = (await (
      await fetch(`${MAILPIT}/api/v1/messages?limit=5`)
    ).json()) as {
      messages: Array<{ ID: string; To: Array<{ Address: string }> }>
    }
    const mine = messages.messages.find((m) =>
      m.To.some((t) => t.Address === email),
    )
    if (mine) {
      const full = (await (
        await fetch(`${MAILPIT}/api/v1/message/${mine.ID}`)
      ).json()) as {
        Text: string
      }
      const code = full.Text.match(/\b\d{6}\b/)?.[0]
      if (code) return code
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no OTP arrived in Mailpit for ${email}`)
}

/** Ask for a code over the API and read it back. For non-UI callers. */
export async function requestOtp(email: string): Promise<string> {
  const base = process.env.SWL_BASE_URL ?? 'http://127.0.0.1:3000'
  await sendOtp(base, email)
  return waitForOtp(email)
}

/**
 * Create an account through the real registration form.
 *
 * Sign-in cannot create a user, so any test needing a *second* identity has to
 * come through here. Same rate-limit dance as signIn: three attempts, waiting
 * out a 429 between them.
 */
export async function registerUser(page: Page, name: string, email: string) {
  await page.goto('/register')
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Email').fill(email)

  const digit1 = page.getByLabel('Digit 1')
  const submit = page.getByRole('button', { name: 'Create account' })

  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await digit1.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Send code' }).click()
      await digit1
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => {})
    }
    if (await digit1.isVisible().catch(() => false)) break
    await page.waitForTimeout(RATE_LIMIT_WAIT)
  }
  await expect(digit1).toBeVisible({ timeout: 30_000 })

  await digit1.fill(await waitForOtp(email))
  await submit.click()

  // The verify endpoint is rate-limited too, and this test may be the third
  // sign-in of the run. A refused verify leaves the boxes cleared and the page
  // on /register, so refill and retry — the same loop signIn uses. Without it
  // this helper fails on timing rather than on anything it is testing.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await page.url().includes('/register'))) return
    if (!(await rateLimited(page))) break
    await page.waitForTimeout(RATE_LIMIT_WAIT)
    await digit1.fill(await waitForOtp(email))
    await submit.click()
  }

  await expect(page).not.toHaveURL(/\/register/, { timeout: 30_000 })
}

/** Read an invitation link out of the mail sent to `email`. */
export async function readInviteLink(email: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const messages = (await (
      await fetch(`${MAILPIT}/api/v1/messages?limit=10`)
    ).json()) as {
      messages: Array<{ ID: string; To: Array<{ Address: string }> }>
    }
    const mine = messages.messages.find((m) =>
      m.To.some((t) => t.Address === email),
    )
    if (mine) {
      const full = (await (
        await fetch(`${MAILPIT}/api/v1/message/${mine.ID}`)
      ).json()) as { Text: string }
      const link = full.Text.match(/https?:\/\/\S*\/invite\/\S+/)?.[0]
      if (link) return link
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no invitation email arrived in Mailpit for ${email}`)
}

const rateLimited = (page: Page) =>
  page
    .getByRole('alert')
    .filter({ hasText: /too many requests/i })
    .first()
    .isVisible()
    .catch(() => false)

/**
 * Sign in through the UI, using the code the UI itself requested, and waiting
 * out the rate limit on either step if it bites.
 *
 * Returns once the app has navigated away from /login.
 */
export async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)

  const digit1 = page.getByLabel('Digit 1')
  const submit = page.getByRole('button', { name: 'Sign in' })

  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await digit1.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Send code' }).click()
      await digit1
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => {})
    }
    if (await digit1.isVisible().catch(() => false)) break

    // Send was refused. Wait the window out and ask again.
    await page.waitForTimeout(RATE_LIMIT_WAIT)
  }
  await expect(digit1).toBeVisible({ timeout: 30_000 })

  const code = await waitForOtp(email)
  await digit1.fill(code)
  // Filling Digit 1 distributes the whole code across the six boxes.
  await submit.click()

  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await page.url().includes('/login'))) return
    if (attempt === 0) {
      // A refused verify clears the boxes; refill and try once more.
      if (await rateLimited(page)) {
        await page.waitForTimeout(RATE_LIMIT_WAIT)
        await digit1.fill(code)
        await submit.click()
        continue
      }
    }
    break
  }

  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })
}

/** Money strings arrive formatted by the server's locale. */
export function parseMoney(text: string): number {
  return Number(text.replace(/[^\d,.-]/g, '').replace(',', '.'))
}

/**
 * Pick an option from a Listbox.
 *
 * The app's dropdowns are custom components, not <select> — the native popup is
 * drawn by the OS and cannot be styled, so it would break the design the moment
 * it opened. That means `selectOption` no longer applies and the interaction is
 * the real one: open the trigger, click the option.
 */
export async function chooseOption(
  page: Page,
  trigger: Locator,
  option: string,
) {
  await trigger.click()
  const item = page.getByRole('option', { name: option, exact: false })
  await item.waitFor({ state: 'visible', timeout: 15_000 })
  await item.click()
  // The panel closes on commit; waiting for that keeps the next assertion from
  // racing the close animation.
  await page.getByRole('option', { name: option, exact: false }).waitFor({
    state: 'hidden',
    timeout: 10_000,
  })
}
