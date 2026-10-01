/**
 * Better Auth configuration.
 *
 * Passwordless email OTP. Three settings here are load-bearing rather than
 * stylistic — see the comments marked ⚠.
 *
 * The instance is built lazily: `env()` validates at first use rather than at
 * import time, so a missing variable produces a clear error on the first
 * request instead of an opaque module-load crash.
 */
import { createServerOnlyFn } from '@tanstack/react-start'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { getDb } from './db'
import * as schema from './db/schema'
import { env } from './db/env'
import { sendOtpEmail } from './email'

const buildAuth = createServerOnlyFn(() => {
  const e = env()

  return betterAuth({
    appName: 'Splitwise',
    secret: e.BETTER_AUTH_SECRET,
    baseURL: e.BETTER_AUTH_URL,

    // Traefik in front of us: read the real client IP from X-Forwarded-For so
    // the rate limiter counts actual callers, not the proxy hop.
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

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
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
          // Fire and forget; a delivery failure surfaces as a failed login.
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
})

let cached: ReturnType<typeof buildAuth> | undefined

/** The Better Auth instance. Created on first access. */
export const auth: ReturnType<typeof buildAuth> = new Proxy({} as never, {
  get(_t, prop, receiver) {
    cached ??= buildAuth()
    return Reflect.get(cached, prop, receiver)
  },
  has(_t, prop) {
    cached ??= buildAuth()
    return Reflect.has(cached, prop)
  },
})

export type Auth = ReturnType<typeof buildAuth>
