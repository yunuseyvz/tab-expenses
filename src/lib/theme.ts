/**
 * Theme switching.
 *
 * Dark mode is a separate art pass, not an inversion, so it needs a real
 * mechanism rather than a `@media` block: a media query cannot express a user
 * override, and it cannot be tested. The class is applied before first paint by
 * the inline script in the root document (see ThemeScript) so there is no flash
 * of the wrong theme.
 *
 * 'system' follows the OS. 'light' and 'dark' are explicit overrides, and the
 * choice persists in localStorage.
 */
export type Theme = 'system' | 'light' | 'dark'

export const THEME_KEY = 'tab:theme'

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return theme
}

export function readStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'system'
  const raw = localStorage.getItem(THEME_KEY)
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  const resolved = resolveTheme(theme)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.style.colorScheme = resolved

  // Keep the browser chrome in step with the page.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? '#2a2c31' : '#f4f4f1')
  }
}

export function setTheme(theme: Theme) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(THEME_KEY, theme)
  }
  applyTheme(theme)
}

/**
 * Runs before paint, inline in <head>, so the correct theme is on <html> before
 * the first frame. Kept as a string because it must not be a module: modules
 * are deferred, which would be too late.
 */
export const THEME_BOOTSTRAP = `(() => {
  try {
    var stored = localStorage.getItem('${THEME_KEY}')
    var theme = stored === 'light' || stored === 'dark' ? stored : null
    var dark = theme
      ? theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches
    if (dark) document.documentElement.classList.add('dark')
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  } catch (e) {
    // A blocked or full localStorage must not stop the app booting.
  }
})()`
