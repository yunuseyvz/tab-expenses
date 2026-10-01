/**
 * Origin allow-list parsing.
 *
 * Security-relevant: this list decides which hosts may make authenticated
 * requests, so a parser that quietly widens it would be a real vulnerability and
 * one that drops entries would look like an app that "randomly" refuses to
 * accept sign-ins.
 */
import { describe, expect, it, vi } from 'vitest'

import { parseOrigins } from './auth-origins'
import type { OriginConfig } from './auth-origins'

const base = (overrides: Partial<OriginConfig> = {}): OriginConfig => ({
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_TRUSTED_ORIGINS: '',
  ...overrides,
})

describe('parseOrigins', () => {
  it('returns undefined when nothing extra is configured', () => {
    // undefined rather than [] — Better Auth then falls back to baseURL alone.
    expect(parseOrigins(base())).toBeUndefined()
    expect(
      parseOrigins(base({ BETTER_AUTH_TRUSTED_ORIGINS: '   ' })),
    ).toBeUndefined()
  })

  it('expands a bare host:port using the base URL scheme', () => {
    expect(
      parseOrigins(base({ BETTER_AUTH_TRUSTED_ORIGINS: 'kaya:3000' })),
    ).toEqual(['http://kaya:3000'])
  })

  it('keeps an explicit scheme as given', () => {
    expect(
      parseOrigins(
        base({
          BETTER_AUTH_URL: 'https://expenses.example.com',
          BETTER_AUTH_TRUSTED_ORIGINS:
            'https://kaya:3000, http://192.168.1.5:3000',
        }),
      ),
    ).toEqual(['https://kaya:3000', 'http://192.168.1.5:3000'])
  })

  it('trims whitespace and drops empty entries', () => {
    expect(
      parseOrigins(
        base({
          BETTER_AUTH_TRUSTED_ORIGINS: '  kaya:3000 , , 10.0.0.4:3000  ,',
        }),
      ),
    ).toEqual(['http://kaya:3000', 'http://10.0.0.4:3000'])
  })

  it('normalises a trailing slash so the same origin is not listed twice', () => {
    expect(
      parseOrigins(base({ BETTER_AUTH_TRUSTED_ORIGINS: 'http://kaya:3000/' })),
    ).toEqual(['http://kaya:3000'])
  })

  it('drops a path, keeping only scheme, host and port', () => {
    // The browser sends an Origin with no path, so a path here could never match.
    expect(
      parseOrigins(
        base({ BETTER_AUTH_TRUSTED_ORIGINS: 'http://kaya:3000/dashboard' }),
      ),
    ).toEqual(['http://kaya:3000'])
  })

  it('warns about and skips an entry that is not a valid origin', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // A typo should not take the server down, but it must not pass silently.
    expect(
      parseOrigins(
        base({ BETTER_AUTH_TRUSTED_ORIGINS: 'http://:::,kaya:3000' }),
      ),
    ).toEqual(['http://kaya:3000'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not treat a path-only or scheme-only string as an origin', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // "localhost:3000" parses as scheme "localhost:" in some inputs; make sure
    // nonsense does not widen the list.
    expect(
      parseOrigins(base({ BETTER_AUTH_TRUSTED_ORIGINS: 'not a url' })),
    ).toBeUndefined()
    warn.mockRestore()
  })
})
