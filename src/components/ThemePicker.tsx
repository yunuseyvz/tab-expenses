/**
 * Light / dark / system toggle.
 *
 * Dark mode is a separate art pass, so the choice is explicit and persisted
 * rather than inferred. Light is the default rather than the OS preference; see
 * DEFAULT_THEME in #/lib/theme.
 */
import { useEffect, useState } from 'react'

import type { Theme } from '#/lib/theme'
import { cn } from '#/lib/cn'
import {
  DEFAULT_THEME,
  applyTheme,
  readStoredTheme,
  setTheme,
} from '#/lib/theme'

const OPTIONS: Array<{ value: Theme; label: string; hint: string }> = [
  { value: 'light', label: 'Light', hint: 'Paper in daylight' },
  { value: 'dark', label: 'Dark', hint: 'Paper under lamplight' },
  { value: 'system', label: 'System', hint: 'Follow the device' },
]

export function ThemePicker({ heading = true }: { heading?: boolean } = {}) {
  // Render neutral on the server and the first client render, then read the
  // stored value. Reading localStorage during render would break hydration.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setThemeState(readStoredTheme())
    setReady(true)
  }, [])

  // Follow the OS while the preference is "system".
  useEffect(() => {
    if (!ready) return
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme, ready])

  return (
    <div>
      {/* `heading={false}` when the control sits inside a row that already says
          what it is. A row labelled "Appearance" with a control underneath it
          captioned "THEME" states the same thing twice, and the second one costs
          a line of vertical space in the middle of a row that is otherwise one
          line tall. */}
      {heading && (
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint mb-2">
          Theme
        </h2>
      )}
      <div
        role="radiogroup"
        aria-label="Theme"
        className="inline-flex p-1 gap-1 well rounded-[var(--radius-sm)]"
      >
        {OPTIONS.map((o) => {
          const active = ready && theme === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={o.hint}
              onClick={() => {
                setTheme(o.value)
                setThemeState(o.value)
              }}
              className={cn(
                'px-3 py-1.5 text-sm rounded-[2px]',
                'transition-[background-color,box-shadow,color] duration-150',
                active
                  ? 'bg-paper-raised text-ink shadow-[var(--shadow-raise)]'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
