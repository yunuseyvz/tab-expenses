/**
 * Theme defaults.
 *
 * Light is the default rather than the OS preference, and that is a decision
 * rather than an implementation detail: an app which shows dark because the
 * machine happens to be dark is an app that shows a stranger the rarer of its
 * two designs first. So it is pinned here, in the environment that matters.
 *
 * The interesting assertion is the last one. `THEME_BOOTSTRAP` runs inline
 * before first paint and is a *string* rather than a module, so the only way to
 * test it is to do what a browser does: build a fake window and run it. Asserting
 * on the source text instead would pass while the behaviour was wrong, which is
 * the exact failure this file exists to catch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_THEME,
  THEME_BOOTSTRAP,
  readStoredTheme,
  resolveTheme,
} from '#/lib/theme'

/** A window whose OS preference is `prefersDark`, and a localStorage to match. */
function browser(prefersDark: boolean, stored?: string) {
  const classes = new Set<string>()
  const style: Record<string, string> = {}
  const values = new Map<string, string>()
  if (stored !== undefined) values.set('tab:theme', stored)

  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: prefersDark && query.includes('dark'),
    }),
  })
  vi.stubGlobal('document', {
    documentElement: {
      classList: {
        add: (c: string) => classes.add(c),
        toggle: (c: string, on: boolean) =>
          on ? classes.add(c) : classes.delete(c),
      },
      style,
    },
  })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
  })

  return { classes, style, values }
}

/** Run the bootstrap the way a browser would. */
function boot() {
  // Not a module: this string is injected into <head>, and `new Function` is the
  // closest a node-environment test gets to what a browser does with a <script>.
  new Function(THEME_BOOTSTRAP)()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('theme default', () => {
  it('is light', () => {
    expect(DEFAULT_THEME).toBe('light')
  })

  it('reads as light when nothing is stored', () => {
    browser(false)
    expect(readStoredTheme()).toBe('light')
  })

  it('still honours a stored preference', () => {
    browser(false, 'dark')
    expect(readStoredTheme()).toBe('dark')
  })

  it('still follows the OS when asked to', () => {
    browser(true)
    expect(resolveTheme('system')).toBe('dark')
    browser(false)
    expect(resolveTheme('system')).toBe('light')
  })

  it('does not go dark on a dark machine until someone asks for it', () => {
    // The regression this file exists for: the OS prefers dark, nothing is
    // stored, and the app must still come up light.
    const { classes, style } = browser(true)
    boot()
    expect(classes.has('dark')).toBe(false)
    expect(style.colorScheme).toBe('light')
  })

  it('goes dark before the first paint when dark was stored', () => {
    const { classes, style } = browser(false, 'dark')
    boot()
    expect(classes.has('dark')).toBe(true)
    expect(style.colorScheme).toBe('dark')
  })

  it('follows the OS when system was stored', () => {
    const dark = browser(true, 'system')
    boot()
    expect(dark.classes.has('dark')).toBe(true)
  })

  it('bootstraps at all when localStorage is unavailable', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    })
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => boot()).not.toThrow()
  })
})
