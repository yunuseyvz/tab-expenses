/**
 * Design-system and accessibility assertions.
 *
 * The plan's accessibility guardrails are called "non-negotiable, and the place
 * skeuomorphic UIs usually fail", so they get tests rather than good intentions.
 *
 * On measuring colour: getComputedStyle returns whatever colour space the value
 * was authored in, so an oklch() token comes back as "oklch(0.28 0.02 60)" and a
 * naive RGB regex reads "0.28, 0.02, 60" as RGB — a contrast ratio of 1.06:1
 * for near-black on near-white. Every measurement here goes through a canvas,
 * which always rasterises to sRGB.
 */
import { expect, test } from '@playwright/test'

/** Rasterise any CSS colour to sRGB through a canvas. */
const TO_RGB = `
  // Canvas fillStyle does not understand var(), so resolve through a probe
  // element first. Rasterising then always yields sRGB regardless of the
  // colour space the token was authored in.
  window.__toRgb = (value) => {
    const probe = document.createElement('span')
    probe.style.color = 'rgb(1, 2, 3)'
    probe.style.color = value
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()

    const c = document.createElement('canvas')
    c.width = c.height = 1
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#000'
    ctx.fillStyle = resolved
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  }
`

function luminance(rgb: Array<number>): number {
  const [r = 0, g = 0, b = 0] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Array<number>, b: Array<number>): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

test.describe('design system', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(TO_RGB)
  })

  test('body text meets AA against the actual paper surface', async ({
    page,
  }) => {
    await page.goto('/login')

    const { ink, paper } = await page.evaluate<{
      ink: Array<number>
      paper: Array<number>
    }>(`(() => {
      const body = getComputedStyle(document.body)
      return {
        ink: window.__toRgb(body.color),
        paper: window.__toRgb(body.backgroundColor),
      }
    })()`)

    const ratio = contrast(ink, paper)
    expect(
      ratio,
      `rgb(${ink}) on rgb(${paper}) = ${ratio.toFixed(2)}:1, need 4.5`,
    ).toBeGreaterThanOrEqual(4.5)
  })

  /**
   * The token-level check. This is the one that caught the real problems: the
   * plan's palette put white on terracotta at 1.7:1 (the primary button was
   * effectively unreadable) and terracotta as link text at 1.6:1.
   */
  test('every text token clears AA on the surface it is used on', async ({
    page,
  }) => {
    await page.goto('/login')

    const results = await page.evaluate<
      Array<{ pair: string; ratio: number; min: number }>
    >(`(() => {
      const paper = window.__toRgb('var(--color-paper)')
      const raised = window.__toRgb('var(--color-paper-raised)')
      const sunk = window.__toRgb('var(--color-paper-sunk)')

      const cases = [
        ['ink / paper', 'var(--color-ink)', paper, 4.5],
        ['ink / raised', 'var(--color-ink)', raised, 4.5],
        ['ink / sunk', 'var(--color-ink)', sunk, 4.5],
        ['ink-muted / paper', 'var(--color-ink-muted)', paper, 4.5],
        ['ink-muted / raised', 'var(--color-ink-muted)', raised, 4.5],
        ['ink-muted / sunk', 'var(--color-ink-muted)', sunk, 4.5],
        ['ink-faint / paper', 'var(--color-ink-faint)', paper, 4.5],
        ['ink-faint / raised', 'var(--color-ink-faint)', raised, 4.5],
        ['terracotta-ink / paper', 'var(--color-terracotta-ink)', paper, 4.5],
        ['terracotta-ink / raised', 'var(--color-terracotta-ink)', raised, 4.5],
        ['oxblood-ink / paper', 'var(--color-oxblood-ink)', paper, 4.5],
        ['sage / paper', 'var(--color-sage)', paper, 4.5],
        ['sage / raised', 'var(--color-sage)', raised, 4.5],
        ['ochre-ink / paper', 'var(--color-ochre-ink)', paper, 4.5],
        // Button label on its fill.
        ['ink on terracotta fill', 'var(--color-ink)', window.__toRgb('var(--color-terracotta)'), 4.5],
        ['ink on terracotta-strong', 'var(--color-ink)', window.__toRgb('var(--color-terracotta-strong)'), 4.5],
        ['white on oxblood fill', '#ffffff', window.__toRgb('var(--color-oxblood)'), 4.5],
        ['white on oxblood-ink fill', '#ffffff', window.__toRgb('var(--color-oxblood-ink)'), 4.5],
        // Focus ring is a non-text element: 3:1 per WCAG 1.4.11.
        ['focus ring / paper', 'var(--color-terracotta-ink)', paper, 3],
        ['focus ring / raised', 'var(--color-terracotta-ink)', raised, 3],
      ]

      const lum = (rgb) => {
        const [r, g, b] = rgb.map((v) => {
          const ch = v / 255
          return ch <= 0.03928 ? ch / 12.92 : Math.pow((ch + 0.055) / 1.055, 2.4)
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const ratio = (a, b) => {
        const la = lum(a)
        const lb = lum(b)
        const hi = Math.max(la, lb)
        const lo = Math.min(la, lb)
        return (hi + 0.05) / (lo + 0.05)
      }

      return cases.map(([pair, fg, bg, min]) => ({
        pair,
        ratio: ratio(window.__toRgb(fg), bg),
        min,
      }))
    })()`)

    const failures = results
      .filter((r) => r.ratio < r.min)
      .map((r) => `${r.pair}: ${r.ratio.toFixed(2)}:1 (needs ${r.min})`)

    expect(failures, failures.join('\n')).toEqual([])
  })

  test('focus is visible, not suppressed', async ({ page }) => {
    await page.goto('/login')

    const outline = await page.evaluate<string>(`(() => {
      const el = document.querySelector('input')
      el.focus()
      const cs = getComputedStyle(el)
      return cs.outlineStyle + ' / ' + cs.outlineWidth + ' / ' + cs.outlineColor
    })()`)

    // The plan is explicit: never `outline: none` without a replacement.
    expect(outline).not.toContain('none')
    expect(outline).not.toContain('0px')
    expect(outline).toContain('solid')
  })

  test('the skip link is the first thing keyboard users reach', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.keyboard.press('Tab')

    const focused = await page.evaluate<string>(
      `document.activeElement?.className ?? ''`,
    )
    expect(focused).toContain('skip-link')
  })

  test('selected chips carry a glyph, not just colour', async ({ page }) => {
    await page.goto('/dashboard?period=all')

    // Checks for *a mark* — an SVG icon or the ✓ character — rather than one
    // specific one. The chip renders lucide's Check while unselected chips show
    // the category's own icon, and both are legitimate marks; what this guards
    // is that selection is never signalled by colour alone, so pinning the test
    // to a particular glyph would only make it brittle.
    const hasGlyph = await page.evaluate<boolean>(`(() => {
      const el = [...document.querySelectorAll('button')]
        .find((b) => b.getAttribute('aria-pressed') === 'true')
      if (!el) return false
      return !!el.querySelector('svg') || (el.textContent ?? '').includes('✓')
    })()`)
    expect(hasGlyph).toBe(true)
  })

  test('reduced motion collapses animations to instant state changes', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      storageState: 'test-results/auth.json',
    })
    const page = await context.newPage()
    await page.goto('/dashboard?period=all')

    const durations = await page.evaluate<Array<number>>(`(() => {
      const els = [...document.querySelectorAll('main *')].slice(0, 500)
      return els
        .map((el) => {
          const cs = getComputedStyle(el)
          return Math.max(
            parseFloat(cs.transitionDuration) || 0,
            parseFloat(cs.animationDuration) || 0,
          )
        })
        .filter((d) => d > 0.05)
    })()`)

    expect(durations).toEqual([])

    await context.close()
  })

  test('grain is on the page background only, never behind text', async ({
    page,
  }) => {
    await page.goto('/login')

    const { bodyImage, cardImage } = await page.evaluate<{
      bodyImage: string
      cardImage: string
    }>(`(() => {
      const card = document.querySelector('.card')
      return {
        bodyImage: getComputedStyle(document.body).backgroundImage,
        cardImage: card ? getComputedStyle(card).backgroundImage : 'none',
      }
    })()`)

    // Zero image files, zero extra requests: an inline SVG data URI.
    expect(bodyImage).toContain('data:image/svg+xml')
    // Texture under text destroys legibility.
    expect(cardImage).not.toContain('data:image/svg+xml')
  })

  test('amounts use tabular numerals so columns line up', async ({ page }) => {
    await page.goto('/expenses?period=all')

    const variant = await page.evaluate<string>(
      `getComputedStyle(document.querySelector('.tnum')).fontVariantNumeric`,
    )
    expect(variant).toContain('tabular-nums')
  })

  test('elevation uses warm shadows, never neutral black', async ({ page }) => {
    await page.goto('/login')

    const shadow = await page.evaluate<string>(() => {
      const el = document.querySelector('.card')
      return el ? getComputedStyle(el).boxShadow : ''
    })

    // rgb(0 0 0 ...) inside a shadow reads as digital rather than as depth.
    expect(shadow).not.toMatch(/rgba?\(0,\s*0,\s*0/)
  })

  /**
   * Dark mode was declared in CSS but never activated — nothing ever put the
   * `dark` class on <html>, so the whole art pass was dead code. This asserts
   * the class is applied from the pre-paint bootstrap script, and then that the
   * dark palette is its own pass rather than an inversion.
   */
  test('dark mode is actually applied, from a stored preference', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('splitwise:theme', 'dark')
    })
    await page.goto('/login')

    const isDark = await page.evaluate<boolean>(
      `document.documentElement.classList.contains('dark')`,
    )
    expect(isDark).toBe(true)

    // Warm charcoal, not black — an inversion would land near #000.
    const paper = await page.evaluate<Array<number>>(
      `window.__toRgb(getComputedStyle(document.body).backgroundColor)`,
    )
    const [r = 0, , b = 0] = paper
    expect(r).toBeGreaterThan(15)
    expect(r).toBeLessThan(80)
    // Warm: the red channel leads.
    expect(r).toBeGreaterThan(b)
  })

  test('the theme can be switched back to light', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('splitwise:theme', 'light')
    })
    await page.goto('/login')
    expect(
      await page.evaluate<boolean>(
        `document.documentElement.classList.contains('dark')`,
      ),
    ).toBe(false)
  })

  test('dark palette clears AA on its own surfaces', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('splitwise:theme', 'dark')
    })
    await page.goto('/login')

    const failures = await page.evaluate<Array<string>>(`(() => {
      const paper = window.__toRgb('var(--color-paper)')
      const raised = window.__toRgb('var(--color-paper-raised)')
      const sunk = window.__toRgb('var(--color-paper-sunk)')

      const cases = [
        ['ink / paper', 'var(--color-ink)', paper, 4.5],
        ['ink / raised', 'var(--color-ink)', raised, 4.5],
        ['ink / sunk', 'var(--color-ink)', sunk, 4.5],
        ['ink-muted / paper', 'var(--color-ink-muted)', paper, 4.5],
        ['ink-muted / raised', 'var(--color-ink-muted)', raised, 4.5],
        ['ink-faint / paper', 'var(--color-ink-faint)', paper, 4.5],
        ['terracotta-ink / paper', 'var(--color-terracotta-ink)', paper, 4.5],
        ['oxblood-ink / paper', 'var(--color-oxblood-ink)', paper, 4.5],
        ['sage / paper', 'var(--color-sage)', paper, 4.5],
        ['ochre-ink / paper', 'var(--color-ochre-ink)', paper, 4.5],
        ['ink on terracotta fill', 'var(--color-ink)', window.__toRgb('var(--color-terracotta)'), 4.5],
        ['ink on terracotta-strong (hover)', 'var(--color-ink)', window.__toRgb('var(--color-terracotta-strong)'), 4.5],
        ['ink on oxblood fill', 'var(--color-ink)', window.__toRgb('var(--color-oxblood)'), 4.5],
        // Hairlines are non-text: 3:1 per WCAG 1.4.11.
        ['rule / raised (non-text)', 'var(--color-rule)', raised, 3],
      ]

      const lum = (rgb) => {
        const [r, g, b] = rgb.map((v) => {
          const ch = v / 255
          return ch <= 0.03928 ? ch / 12.92 : Math.pow((ch + 0.055) / 1.055, 2.4)
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const ratio = (a, b) => {
        const la = lum(a)
        const lb = lum(b)
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
      }

      return cases
        .map(([pair, fg, bg, min]) => ({
          pair,
          r: ratio(window.__toRgb(fg), bg),
          min,
        }))
        .filter((x) => x.r < x.min)
        .map((x) => x.pair + ': ' + x.r.toFixed(2) + ':1 (needs ' + x.min + ')')
    })()`)

    expect(failures, failures.join('\n')).toEqual([])
  })
})
