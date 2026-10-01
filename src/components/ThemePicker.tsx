/**
 * Light / dark / system toggle.
 *
 * Dark mode is a separate art pass, so the choice is explicit and persisted
 * rather than inferred — and the OS preference is respected until overridden.
 */
import { useEffect, useState } from 'react'

import type { Theme } from '#/lib/theme'
import { cn } from '#/lib/cn'
import { applyTheme, readStoredTheme, setTheme } from '#/lib/theme'

const OPTIONS: Array<{ value: Theme; label: string; hint: string }> = [
  { value: 'light', label: 'Light', hint: 'Paper in daylight' },
  { value: 'dark', label: 'Dark', hint: 'Paper under lamplight' },
  { value: 'system', label: 'System', hint: 'Follow the device' },
]

export function ThemePicker() {
  // Render neutral on the server and the first client render, then read the
  // stored value. Reading localStorage during render would break hydration.
  const [theme, setThemeState] = useState<Theme>('system')
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
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint mb-2">
        Theme
      </h2>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="inline-flex p-1 gap-1 well rounded-[3px]"
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
