/**
 * Runtime environment access.
 *
 * Vite inlines any `VITE_*` variable into the client bundle at BUILD time.
 * That makes `VITE_` names unsafe for secrets, so every value in this file is
 * read from `process.env` lazily and the prefix is never used.
 *
 * Nothing here runs at module scope: importing this file from the client is
 * safe, it simply throws if you actually call a getter there.
 */
import { z } from 'zod'

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  BETTER_AUTH_SECRET: z
    .string()
    .min(16, 'BETTER_AUTH_SECRET must be >= 16 chars'),
  BETTER_AUTH_URL: z.url(),
  /**
   * Extra origins allowed to make authenticated requests, comma separated.
   *
   * BETTER_AUTH_URL is both the canonical base URL *and* the allowed-Origin
   * list, so on its own it permits exactly one hostname. Reaching the same app
   * through a second name — a Tailscale hostname, a LAN IP, a tunnel — is
   * refused with "Invalid origin" until that name is listed here.
   */
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional().default(''),
  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM: z.string().min(1).default('Splitwise <noreply@example.com>'),
  // Mailpit's HTTP API (port 8025), not its SMTP port. We deliver through the
  // REST send endpoint rather than speaking SMTP, so this is the only mail
  // address we need in dev.
  MAILPIT_API_URL: z.string().optional().default('http://localhost:8025'),
  TRUSTED_PROXY_HEADERS: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  NODE_ENV: z
    .string()
    .optional()
    .default('development')
    .transform((v) => v as 'development' | 'production' | 'test'),
})

export type ServerEnv = z.infer<typeof serverSchema>

let cached: ServerEnv | undefined

/**
 * Parse and cache the server env. Throws a readable error listing every
 * problem at once rather than failing on the first missing variable.
 */
export function env(): ServerEnv {
  if (cached) return cached

  const parsed = serverSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_TRUSTED_ORIGINS:
      process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? undefined,
    RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
    EMAIL_FROM: process.env.EMAIL_FROM ?? undefined,
    MAILPIT_API_URL: process.env.MAILPIT_API_URL ?? undefined,
    TRUSTED_PROXY_HEADERS: process.env.TRUSTED_PROXY_HEADERS ?? undefined,
    NODE_ENV: process.env.NODE_ENV ?? undefined,
  })

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid server environment:\n${detail}`)
  }

  cached = parsed.data
  return cached
}

/** True when we should deliver mail through Mailpit rather than Resend. */
export function usesMailpit(e: ServerEnv = env()): boolean {
  return e.RESEND_API_KEY.length === 0
}
