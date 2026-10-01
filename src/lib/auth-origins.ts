/**
 * Origin allow-list parsing for Better Auth.
 *
 * `baseURL` doubles as Better Auth's allowed-Origin list, so on its own it
 * permits exactly one hostname. Reaching the same app through a second name — a
 * Tailscale hostname, a LAN IP, a tunnel — is refused with "Invalid origin"
 * until that name is listed in BETTER_AUTH_TRUSTED_ORIGINS.
 *
 * Kept separate from ./auth so it is a pure function with no database or
 * server-only import, and therefore directly testable.
 */
import { z } from 'zod'

const originSchema = z.url()

export interface OriginConfig {
  BETTER_AUTH_URL: string
  BETTER_AUTH_TRUSTED_ORIGINS?: string
}

/**
 * Normalise the extra allowed origins to full origins (`scheme://host[:port]`),
 * which is what a browser sends in `Origin` and what Better Auth compares
 * against.
 *
 * A bare `host:port` is expanded using BETTER_AUTH_URL's scheme, so
 * `kaya:3000` and `https://kaya:3000` both do the obvious thing.
 *
 * Unparseable entries are dropped with a warning rather than crashing the
 * server: a typo in a comma-separated list should not take the app down, but it
 * should not pass silently either.
 *
 * @returns the extra origins, or undefined when there are none — in which case
 * Better Auth falls back to baseURL alone.
 */
export function parseOrigins(config: OriginConfig): Array<string> | undefined {
  const raw = (config.BETTER_AUTH_TRUSTED_ORIGINS ?? '').trim()
  if (raw.length === 0) return undefined

  const base = originSchema.parse(config.BETTER_AUTH_URL)
  const baseProtocol = new URL(base).protocol

  const out: Array<string> = []
  for (const entry of raw.split(',')) {
    const value = entry.trim()
    if (!value) continue

    // Only prepend a scheme when the entry has none. `new URL` would otherwise
    // read "localhost:3000" as the scheme "localhost:" rather than a host.
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      ? value
      : `${baseProtocol}//${value}`

    const parsed = originSchema.safeParse(candidate)
    if (!parsed.success) {
      console.warn(
        `[auth] ignoring BETTER_AUTH_TRUSTED_ORIGINS entry that is not a valid origin: ${value}`,
      )
      continue
    }

    // `.origin` drops any path, query, or fragment — and normalises the
    // trailing slash, so `http://kaya:3000/` cannot become a second entry.
    out.push(new URL(parsed.data).origin)
  }

  return out.length > 0 ? out : undefined
}
