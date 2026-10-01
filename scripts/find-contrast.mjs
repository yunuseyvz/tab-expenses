/**
 * One-off: find OKLCH lightness values that satisfy contrast targets, measured
 * in the browser rather than a hand-rolled conversion.
 *
 * Usage: node scripts/find-contrast.mjs
 */
import { chromium } from '@playwright/test'

const SURFACES = {
  paper: 'oklch(0.965 0.012 85)',
  raised: 'oklch(0.978 0.010 85)',
  sunk: 'oklch(0.93 0.014 85)',
}

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<body></body>')

const measure = await page.evaluate(
  ({ surfaces, targets }) => {
    const toRgb = (value) => {
      const probe = document.createElement('span')
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

    const out = {}
    for (const [name, spec] of Object.entries(targets)) {
      const [C, H] = spec
      const found = {}
      for (const [sName, sSpec] of Object.entries(surfaces)) {
        const bg = toRgb(sSpec)
        // Walk lightness down from bright to dark and take the first that
        // clears the target, i.e. the lightest passing value.
        for (let L = 0.95; L >= 0.05; L -= 0.005) {
          if (ratio(toRgb(`oklch(${L.toFixed(3)} ${C} ${H})`), bg) >= 4.5) {
            found[sName] = {
              L: L.toFixed(3),
              ratio: ratio(toRgb(`oklch(${L.toFixed(3)} ${C} ${H})`), bg).toFixed(2),
            }
            break
          }
        }
        if (!found[sName]) found[sName] = null
      }
      out[name] = found
    }

    // Cross-checks: a foreground against a specific fill.
    out.__fills = {
      'ink on terracotta 0.62': ratio(
        toRgb('oklch(0.28 0.02 60)'),
        toRgb('oklch(0.62 0.13 45)'),
      ).toFixed(2),
      'ink on terracotta 0.60': ratio(
        toRgb('oklch(0.28 0.02 60)'),
        toRgb('oklch(0.60 0.13 45)'),
      ).toFixed(2),
      'ink on terracotta 0.58': ratio(
        toRgb('oklch(0.28 0.02 60)'),
        toRgb('oklch(0.58 0.13 45)'),
      ).toFixed(2),
      'white on oxblood-ink 0.34': ratio(
        toRgb('#ffffff'),
        toRgb('oklch(0.34 0.14 20)'),
      ).toFixed(2),
      'white on oxblood 0.48': ratio(
        toRgb('#ffffff'),
        toRgb('oklch(0.48 0.14 20)'),
      ).toFixed(2),
      'ink on oxblood 0.48': ratio(
        toRgb('oklch(0.28 0.02 60)'),
        toRgb('oklch(0.48 0.14 20)'),
      ).toFixed(2),
      'terracotta 0.62 vs paper': ratio(
        toRgb('oklch(0.62 0.13 45)'),
        toRgb(surfaces.paper),
      ).toFixed(2),
    }
    return out
  },
  {
    surfaces: SURFACES,
    targets: {
      'ink C=0.02 H=60': [0.02, 60],
      'ink-muted C=0.018 H=60': [0.018, 60],
      'ink-faint C=0.014 H=60': [0.014, 60],
      'terracotta-ink C=0.11 H=45': [0.11, 45],
      'oxblood-ink C=0.14 H=20': [0.14, 20],
      'ochre-ink C=0.11 H=80': [0.11, 80],
      'sage C=0.075 H=150': [0.075, 150],
    },
  },
)

console.log(JSON.stringify(measure, null, 2))
await browser.close()
