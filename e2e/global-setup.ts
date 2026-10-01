/**
 * Playwright global setup: establish ONE authenticated session and share it.
 *
 * Better Auth hardens the OTP endpoints to 3 requests per 60 seconds, which is
 * correct for production and hostile to a test suite that signs in per test.
 * Signing in once here and reusing storageState keeps the suite both fast and
 * honest — the rate limiter stays enabled rather than being disabled for tests.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const BASE = process.env.SWL_BASE_URL ?? 'http://127.0.0.1:3000'
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025'
const EMAIL = process.env.SWL_E2E_EMAIL ?? 'demo@splitwise.local'
const OUT = 'test-results/auth.json'

export default async function globalSetup() {
  // Better Auth's CSRF check requires an Origin. Sending it is not a workaround
  // — it is what a browser does, and omitting it is correctly rejected.
  const headers = {
    'Content-Type': 'application/json',
    Origin: BASE,
    Referer: `${BASE}/login`,
  }

  const res = await fetch(`${BASE}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: EMAIL, type: 'sign-in' }),
  })
  if (!res.ok) {
    throw new Error(
      `send-verification-otp failed: ${res.status} ${await res.text()}`,
    )
  }

  const code = await waitForCode(EMAIL)
  if (!code) throw new Error(`no OTP arrived in Mailpit for ${EMAIL}`)

  const signIn = await fetch(`${BASE}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: EMAIL, otp: code }),
  })
  if (!signIn.ok) {
    throw new Error(`sign-in failed: ${signIn.status} ${await signIn.text()}`)
  }

  // Capture the session cookie into Playwright's storageState format.
  const setCookie = signIn.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error('sign-in succeeded but set no cookie — is tanstackStartCookies() last?')
  }
  const [pair] = setCookie.split(';')
  const eq = pair!.indexOf('=')
  const name = pair!.slice(0, eq)
  const value = pair!.slice(eq + 1)
  const url = new URL(BASE)

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        cookies: [
          {
            name,
            value,
            domain: url.hostname,
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
          },
        ],
        origins: [],
      },
      null,
      2,
    ),
  )
  console.log(`e2e: signed in as ${EMAIL}, session written to ${OUT}`)
}

async function waitForCode(email: string): Promise<string | null> {
  for (let i = 0; i < 40; i++) {
    const list = (await (
      await fetch(`${MAILPIT}/api/v1/messages?limit=10`)
    ).json()) as {
      messages: Array<{ ID: string; To: Array<{ Address: string }> }>
    }
    const mine = list.messages.find((m) =>
      m.To.some((t) => t.Address === email),
    )
    if (mine) {
      const full = (await (
        await fetch(`${MAILPIT}/api/v1/message/${mine.ID}`)
      ).json()) as { Text: string }
      const code = full.Text.match(/\b\d{6}\b/)?.[0]
      if (code) return code
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}
