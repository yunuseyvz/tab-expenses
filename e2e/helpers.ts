/**
 * Shared E2E helpers.
 *
 * Signing in goes through the real OTP flow: request a code, then read it out of
 * Mailpit's HTTP API. No test-only backdoor, so the tests exercise the same
 * path a user does.
 */
import {  expect } from '@playwright/test'
import type {Page} from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025'

export async function requestOtp(email: string): Promise<string> {
  const base = process.env.SWL_BASE_URL ?? 'http://127.0.0.1:3000'
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
  if (!res.ok) {
    throw new Error(`send-verification-otp failed: ${res.status} ${await res.text()}`)
  }

  // Delivery is deliberately not awaited by the auth hook, so poll.
  for (let i = 0; i < 40; i++) {
    const messages = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=5`)).json()) as {
      messages: Array<{ ID: string; To: Array<{ Address: string }> }>
    }
    const mine = messages.messages.find((m) =>
      m.To.some((t) => t.Address === email),
    )
    if (mine) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${mine.ID}`)).json()) as {
        Text: string
      }
      const code = full.Text.match(/\b\d{6}\b/)?.[0]
      if (code) return code
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no OTP arrived in Mailpit for ${email}`)
}

export async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send code' }).click()

  const code = await requestOtp(email)
  const digits = code.split('')
  for (const [i, d] of digits.entries()) {
    await page.getByLabel(`Digit ${i + 1}`).fill(d)
  }
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** Money strings arrive formatted by the server's locale. */
export function parseMoney(text: string): number {
  return Number(text.replace(/[^\d,.-]/g, '').replace(',', '.'))
}
