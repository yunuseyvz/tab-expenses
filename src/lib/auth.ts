/**
 * Better Auth configuration.
 *
 * Passwordless email OTP. Three settings here are load-bearing rather than
 * stylistic — see the comments marked ⚠.
 */
import 'server-only'

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { getDb } from './db'
import * as schema from './db/schema'
import { env } from './db/env'
import { sendOtpEmail } from './email'

const e = env()

export const auth = betterAuth({
  appName: 'Splitwise',
  secret: e.BETTER_AUTH_SECRET,
  baseURL: e.BETTER_AUTH_URL,

  // Traefik in front of us: read the real client IP from X-Forwarded-For so the
  // rate limiter counts actual callers, not the proxy hop.
  trustedProxyHeaders: e.TRUSTED_PROXY_HEADERS,

  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  emailAndPassword: {
    enabled: false,
  },

  user: {
    // Unknown emails auto-provision on first OTP sign-in.
    additionalFields: {},
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },

  advanced: {
    // OTP codes and the verification table are short-lived; let the adapter
    // reuse the same pool we already opened.
    database: { generateId: false },
  },

  plugins: [
    emailOTP({
      otpLength: 6,
      allowedAttempts: 3, // 3 wrong guesses forces a resend
      resendStrategy: 'rotate', // invalidate the old code on resend
      expiresIn: 600, // 10 minutes
      // ⚠ DEFAULT IS 'plain' TEXT. Override it, or a DB dump hands over live
      // login codes. Hashing costs nothing.
      storeOTP: 'hashed',
      // eslint-disable-next-line @typescript-eslint/require-await -- intentionally not awaited: see below
      async sendVerificationOTP({ email: to, otp, type }) {
        // Not awaited: awaiting inside this hook is a timing side channel.
        // Fire and forget; delivery failure surfaces as a failed login.
        void sendOtpEmail({ to, otp, type }).catch((err) => {
          console.error('[auth] OTP delivery failed', err)
        })
      },
    }),
    // ⚠ MUST BE LAST IN THE ARRAY. Without it (or in any other position) any
    // Better Auth call that sets a cookie — including OTP sign-in — fails to
    // persist through Start's SSR. This is the single most common
    // TanStack Start auth bug: login "succeeds" then lands unauthenticated.
    tanstackStartCookies(),
  ],
})

export type Auth = typeof auth
