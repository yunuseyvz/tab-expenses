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
import { devices, expect, test } from '@playwright/test'

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
  // The table below was light-only for its whole life, which is a hole: on dark
  // paper the same tokens are re-declared at different lightnesses, so a value
  // that measures 5.9:1 in light can measure 3.1:1 in dark and nothing notices.
  // Both themes are now measured, from the same list.
  for (const theme of ['light', 'dark'] as const) {
    test(`every text token clears AA on the surface it is used on (${theme})`, async ({
      page,
    }) => {
      if (theme === 'dark') {
        // Before any script runs, so the app's own resolver never paints light
        // first and every token is read at its dark value.
        await page.addInitScript(() => {
          localStorage.setItem('tab:theme', 'dark')
          document.documentElement.classList.add('dark')
        })
      }
      await page.goto('/login')
      // Without this, a broken theme switch would measure light twice and the
      // dark half of this loop would be a silent no-op that always passes.
      expect(
        await page.evaluate(() =>
          document.documentElement.classList.contains('dark')
            ? 'dark'
            : 'light',
        ),
        'theme did not apply, so the dark run would just re-measure light',
      ).toBe(theme)

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
        // The danger button's own fill token. Measuring white against
        // oxblood-ink instead — which is what this did — is how the dark theme
        // shipped a Delete button at 2.6:1: oxblood-ink is a *text* colour, and
        // on dark paper it is a light step.
        ['white on danger fill', '#ffffff', window.__toRgb('var(--color-danger-fill)'), 4.5],
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
  }

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

  /**
   * A regression guard, and the reason it is here at all.
   *
   * The floating bar's wrapper once carried `aria-hidden`, put there to hide a
   * decorative gradient scrim. It hid the entire primary navigation with it:
   * the <nav> landmark and the space menu both live inside that wrapper. Nothing
   * broke visibly — the bar rendered, looked right, and was tappable — but a
   * screen reader would have found no main navigation on a phone, and a
   * Playwright locator by role could not find a button that was plainly on
   * screen. It is exactly the class of regression that ships, because a
   * misplaced attribute is invisible in a screenshot.
   *
   * `getByRole` only matches what is exposed to the accessibility tree, so
   * asserting through it is the assertion. A CSS selector would have passed
   * throughout, which is why the bug survived a first reading.
   */
  test('the floating navigation is exposed to assistive technology', async ({
    browser,
  }) => {
    // The phone project, because the sidebar is display:none there and only one
    // `navigation` landmark with this name exists to be found.
    const context = await browser.newContext({
      ...devices['Pixel 7'],
      storageState: 'test-results/auth.json',
    })
    const page = await context.newPage()
    await page.goto('/dashboard')

    // Reachable by role, at every size: the sidebar's on desktop, the floating
    // bar's on a phone. `.first()` because on a wide viewport both are in the
    // DOM and only one of them is visible.
    await expect(
      page.getByRole('navigation', { name: 'Main' }).first(),
    ).toBeVisible()

    // And so is what it opens. A menu rendered inside an aria-hidden ancestor
    // is the same bug one level deeper, and this is the only way it is reached
    // in practice.
    // `:visible`, not just `.first()`: the sidebar's switcher comes earlier in
    // the DOM and is display:none on a phone, so `.first()` picks a button that
    // can never be clicked and the test waits until it is over.
    await page
      .locator('button[aria-haspopup="listbox"]:visible')
      .first()
      .click()
    await expect(page.getByRole('listbox')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New space' })).toBeVisible()

    await context.close()
  })

  /**
   * Only changing household moves anything. Moving between sections does not.
   *
   * Both halves matter, and the second is the one that regresses quietly. A blur
   * is `filter`, the most expensive thing in this app to animate, and paying for
   * it every time someone taps one of four tabs is paying for it dozens of times
   * a session. It belongs to the moment the numbers on screen are about a
   * different household, and nowhere else.
   *
   * Getting that right needed a latch which survives the shell being replaced,
   * because each route renders its own <AppShell>: any per-instance state resets
   * on arrival, so a section change re-fires the entrance no matter what the
   * content is keyed on. See paintedSpace in AppShell.tsx.
   *
   * The blur itself is asserted in spaces.spec.ts, the only test with two spaces
   * to switch between.
   */
  test('moving between sections and filters animates nothing', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')

    /**
     * Watch the content wrapper across whatever the callback does. Reads the
     * computed style every frame, because the animation is JS-driven and leaves
     * no CSS transition for a stylesheet assertion to find.
     */
    const watch = async (act: () => Promise<void>) => {
      await page.evaluate(() => {
        const out: Array<{
          blur: number
          opacity: number
          willChange: string
        }> = []
        const t0 = performance.now()
        const tick = () => {
          // Re-queried every frame, and this is not a detail. Each route renders
          // its own <AppShell>, so navigating *replaces* the content wrapper.
          // A reference captured before the click is a detached node by the time
          // the animation runs, and every frame then reports the settled style
          // of something no longer on the page — which reads as "the animation
          // does not happen" and is indistinguishable from a real failure.
          const el = document.querySelector('#main')?.parentElement
          if (!el) {
            if (performance.now() - t0 < 700) requestAnimationFrame(tick)
            else (window as unknown as { __frames: typeof out }).__frames = out
            return
          }
          const cs = getComputedStyle(el)
          out.push({
            blur: parseFloat(cs.filter.replace(/[^\d.]/g, '')) || 0,
            opacity: Number(cs.opacity),
            willChange: cs.willChange,
          })
          if (performance.now() - t0 < 700) requestAnimationFrame(tick)
          else;
          ;(window as unknown as { __frames: typeof out }).__frames = out
        }
        tick()
      })
      await act()
      await page.waitForTimeout(900)
      return page.evaluate(
        () =>
          (
            window as unknown as {
              __frames?: Array<{
                blur: number
                opacity: number
                willChange: string
              }>
            }
          ).__frames ?? [],
      )
    }

    const navigation = await watch(async () => {
      await page.getByRole('link', { name: 'Expenses' }).click()
    })
    await expect(page).toHaveURL(/expenses/)
    expect(
      Math.max(...navigation.map((f) => f.blur)),
      'a section change should not blur',
    ).toBe(0)
    expect(
      Math.min(...navigation.map((f) => f.opacity)),
      'a section change should not fade either',
    ).toBe(1)

    // And back again, because the guard has to hold in both directions.
    const back = await watch(async () => {
      await page.getByRole('link', { name: 'Dashboard' }).click()
    })
    await expect(page).toHaveURL(/dashboard/)
    expect(
      Math.max(...back.map((f) => f.blur)),
      'navigating back should not blur',
    ).toBe(0)

    const filtering = await watch(async () => {
      await page.getByRole('radio', { name: 'Last month' }).click()
    })
    expect(
      Math.max(...filtering.map((f) => f.blur)),
      'changing the period must not blur the list being filtered',
    ).toBe(0)
    expect(
      Math.min(...filtering.map((f) => f.opacity)),
      'and must not fade it either',
    ).toBe(1)

    // Nothing left will-change behind. This is the assertion that keeps a
    // compositor hint from outliving the animation it was for: left on, it holds
    // a full-page rasterised layer for the rest of the session, and nothing about
    // that is visible in a screenshot.
    const settled = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('#main')!.parentElement!)
          .willChange,
    )
    expect(
      settled,
      'a permanent will-change: filter holds a full-page layer forever',
    ).toBe('auto')
  })

  /**
   * A popover may not push the page sideways.
   *
   * Two symptoms, one cause, and the second is the one that made this hard to
   * see. The date panel hung 149px off the right of a phone, and the fix for
   * "off the right" was to measure against the visible width — but the panel
   * overflowed, Chrome widened the *layout* viewport to fit the overflow, and the
   * clamp then measured that widened viewport and reported the panel as fitting.
   * A loop, with the correct answer at no point in it.
   *
   * So this asserts the thing a person would notice rather than the thing the
   * code computes: the panel's own box is inside the window, and the document
   * has not gained a horizontal scrollbar. The second is what "shifts
   * everything" was — not the panel being visible but slightly wrong, the whole
   * page becoming horizontally scrollable and sliding under your thumb.
   */
  test('the custom date panel stays on screen and the page does not widen', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ...devices['Pixel 7'],
      storageState: 'test-results/auth.json',
    })
    const page = await context.newPage()
    await page.goto('/dashboard')

    const width = async () =>
      page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }))

    const before = await width()
    expect(
      before.scroll,
      'the page should not be horizontally scrollable to begin with',
    ).toBe(before.client)

    await page.getByRole('radio', { name: 'Custom' }).click()
    const panel = page.getByRole('dialog', { name: 'Custom date range' })
    await expect(panel).toBeVisible()

    const box = await panel.boundingBox()
    const viewport = before.client
    expect(
      box!.x,
      'the panel must not start off the left edge',
    ).toBeGreaterThanOrEqual(0)
    expect(
      box!.x + box!.width,
      'the panel must not hang off the right edge',
    ).toBeLessThanOrEqual(viewport)

    const after = await width()
    expect(
      after.scroll,
      'opening a popover must not make the page horizontally scrollable',
    ).toBe(after.client)

    await context.close()
  })

  /**
   * A form field has to be visible as a field.
   *
   * WCAG 1.4.11 wants 3:1 for a boundary you are meant to be able to see, and
   * the expense sheet was at 1.15:1 — the panel is #f9fbfc and a sunken field
   * barely separated from it, so the form read as a wall of pale grey
   * rectangles. It looked like a contrast problem and was reported as one, which
   * is why it is worth a test: the text in that sheet passes AA comfortably, so
   * nothing about the *text* was ever going to catch it.
   *
   * The edge is measured, not the fill. A filled well cannot reach 3:1 against a
   * light panel without becoming a grey box that reads as disabled, so the line
   * has to carry it — which means the assertion is on the border.
   */
  test('a form field is a visible boundary, not a slightly different grey', async ({
    browser,
  }) => {
    for (const theme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        ...devices['Pixel 7'],
        storageState: 'test-results/auth.json',
      })
      const page = await context.newPage()
      // The beforeEach installs __toRgb on the fixture page; this test makes its
      // own contexts, so the helper has to go with them.
      await page.addInitScript(TO_RGB)
      await page.addInitScript((t) => {
        localStorage.setItem('tab:theme', t)
      }, theme)
      await page.goto('/expenses?period=all')
      await page.getByRole('button', { name: 'New expense' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()

      const measured = await page.evaluate<string>(`(() => {
        const sheet = document.querySelector('[role=dialog]')
        const field = sheet.querySelector('#amount')
        const panel = window.__toRgb(getComputedStyle(sheet).backgroundColor)
        const border = window.__toRgb(getComputedStyle(field).borderTopColor)
        return JSON.stringify({ panel, border })
      })()`)
      const { panel, border } = JSON.parse(measured) as {
        panel: Array<number>
        border: Array<number>
      }

      expect(
        contrast(border, panel),
        `the ${theme} field edge against the sheet panel`,
      ).toBeGreaterThanOrEqual(3)

      await context.close()
    }
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
      localStorage.setItem('tab:theme', 'dark')
    })
    await page.goto('/login')

    const isDark = await page.evaluate<boolean>(
      `document.documentElement.classList.contains('dark')`,
    )
    expect(isDark).toBe(true)

    // Charcoal, not black — an inversion would land near #000.
    const paper = await page.evaluate<Array<number>>(
      `window.__toRgb(getComputedStyle(document.body).backgroundColor)`,
    )
    const [r = 0, , b = 0] = paper
    expect(r).toBeGreaterThan(15)
    expect(r).toBeLessThan(80)
    // The cool tint, asserted in the direction the palette now runs. This used
    // to be `r > b` — "warm charcoal" — which was a true statement about the
    // palette at the time and a trap the moment the paper stopped being warm.
    // A test that pins a hue direction silently becomes a test that pins the
    // old brand, so it is written to say what is meant now.
    expect(b).toBeGreaterThan(r)
  })

  test('the theme can be switched back to light', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('tab:theme', 'light')
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
      localStorage.setItem('tab:theme', 'dark')
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

/**
 * Popovers hang off their trigger, in both directions.
 *
 * Two bugs that a screenshot hides and a measurement does not.
 *
 * The switcher's menu opened 101px *above* the space it belongs to, covering the
 * sidebar's own logo. Cause: the switcher's wrapper is `flex items-center`, and an
 * absolutely-positioned child of a flex container is aligned as if it were the
 * sole flex item — so with `top` left to its static position the menu was
 * vertically centred against the trigger and, being taller than it, sat above.
 * The mobile variant never showed it, because `bottom-full` overrides the
 * vertical static position outright, so "it works on my phone" was true and
 * meant nothing.
 *
 * And the avatar picker inside the space editor's sheet was positioned
 * `absolute` inside a scrolling, `overflow-hidden` frame, so its last rows of
 * icons were clipped away and unreachable — a control that looks complete and
 * cannot be used. It is on `<body>` as `fixed` now, and this asserts the
 * property that matters: every option is genuinely hit-testable.
 */
test.describe('popover placement', () => {
  test.use({ storageState: 'test-results/auth.json' })

  test('the switcher menu opens below the trigger and leaves it clickable', async ({
    page,
  }) => {
    // Desktop explicitly. The whole suite runs at Pixel 7, where the switcher is
    // the mark in the floating bar and its menu opens *upward* on purpose — so a
    // test written for the sidebar would either be skipped here or, worse, pass
    // by asserting the mobile behaviour. The sidebar is where the bug was.
    await page.setViewportSize({ width: 1280, height: 900 })

    await page.goto('/dashboard')
    // Not scoped to the navigation landmark: in the desktop layout the sidebar's
    // switcher sits in the <aside> *above* the <nav>, and only the mobile bar's
    // is inside one. At 1280 exactly one trigger is visible, so :visible is the
    // honest way to say "whichever one this layout has".
    const trigger = page
      .locator('button[aria-haspopup=listbox]:visible')
      .first()
    await trigger.click()

    const menu = page.getByRole('listbox', { name: 'Switch space' })
    await expect(menu).toBeVisible()

    const t = (await trigger.boundingBox())!
    const m = (await menu.boundingBox())!
    expect(t, 'the trigger must be on screen').not.toBeNull()
    expect(m, 'the menu must be on screen').not.toBeNull()

    // Below the trigger, by one gap. `top-full` plus `mt-1.5` is what produces
    // this; a margin alone leaves `top` on its static position and the menu
    // centres itself against the trigger.
    expect(
      m.y - (t.y + t.height),
      'the menu must hang below the trigger by its gap, not above it',
    ).toBeGreaterThanOrEqual(0)
    expect(m.y - (t.y + t.height)).toBeLessThanOrEqual(16)

    // And the trigger is still the thing under its own centre. The sidebar is
    // `backdrop-filter`ed, which makes it a stacking context, so a menu wider
    // than the sidebar overhangs into the page column — where, before it was
    // given a z-index of its own, `main` painted over it and swallowed clicks.
    expect(
      await page.evaluate((box) => {
        const el = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        )
        return (
          el?.closest('button')?.getAttribute('aria-haspopup') === 'listbox'
        )
      }, t),
      'the trigger must still be the topmost element at its own centre',
    ).toBe(true)
  })

  test('every avatar option in the space editor is reachable', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await page
      .getByRole('navigation', { name: 'Main' })
      .locator('button[aria-haspopup=listbox]')
      .first()
      .click()
    await page
      .getByRole('button', { name: /^Edit / })
      .first()
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page
      .getByRole('button', { name: /Change/ })
      .first()
      .click()
    const panel = page.getByRole('listbox', { name: 'Space avatar' })
    await expect(panel).toBeVisible()

    // Portalled: not a descendant of the form it was opened from.
    expect(
      await page.evaluate(() => {
        const el = document.querySelector(
          '[role="listbox"][aria-label="Space avatar"]',
        )
        return !!el && !el.closest('form')
      }),
      'the panel must not live inside the sheet, or the sheet clips it',
    ).toBe(true)

    // On screen, all of it.
    const box = (await panel.boundingBox())!
    const vh = await page.evaluate(() => document.documentElement.clientHeight)
    expect(box.y, 'the panel must be on screen').toBeGreaterThanOrEqual(0)
    expect(
      box.y + box.height,
      'the panel must not run off the bottom of the viewport',
    ).toBeLessThanOrEqual(vh)

    // The real assertion: hit-test every option. A clipped panel still *renders*
    // its full height in the DOM, so counting options proves nothing and
    // asserting the bounding box proves little — what fails is the click.
    const options = panel.getByRole('option')
    const total = await options.count()
    expect(total).toBeGreaterThanOrEqual(30)

    const unreachable: Array<number> = []
    for (let i = 0; i < total; i++) {
      const b = await options.nth(i).boundingBox()
      if (!b) {
        unreachable.push(i)
        continue
      }
      const hits = await page.evaluate(
        (pt: { x: number; y: number }) =>
          !!document.elementFromPoint(pt.x, pt.y)?.closest('[role="option"]'),
        { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      )
      if (!hits) unreachable.push(i)
    }
    expect(
      unreachable,
      `options not clickable at their own centre: ${unreachable.join(', ')}`,
    ).toEqual([])
  })
})
