/**
 * One-off: find dark-mode OKLCH values meeting contrast targets, measured in
 * the browser. Dark mode is a separate art pass, and the fill/text roles swap:
 * a near-white label needs a dark fill, and link text on dark paper needs to
 * be lighter than the fill.
 */
import { chromium } from '@playwright/test'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<body></body>')

const out = await page.evaluate(() => {
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

  const paper = toRgb('oklch(0.22 0.014 70)')
  const raised = toRgb('oklch(0.26 0.016 70)')
  const sunk = toRgb('oklch(0.19 0.012 70)')
  const ink = toRgb('oklch(0.92 0.012 85)')

  // For TEXT on dark surfaces, walk lightness UP from dark to find the
  // darkest value that still clears 4.5.
  const textOn = (C, H, bgs) => {
    for (let L = 0.2; L <= 1; L += 0.005) {
      const c = toRgb(`oklch(${L.toFixed(3)} ${C} ${H})`)
      if (bgs.every((bg) => ratio(c, bg) >= 4.5)) return L.toFixed(3)
    }
    return null
  }
  // For a FILL carrying a near-white label, walk lightness DOWN.
  const fillFor = (C, H) => {
    for (let L = 0.9; L >= 0.05; L -= 0.005) {
      if (ratio(ink, toRgb(`oklch(${L.toFixed(3)} ${C} ${H})`)) >= 4.5) {
        return L.toFixed(3)
      }
    }
    return null
  }

  return {
    'ink-muted C=0.014 H=80 (text on paper)': textOn(0.014, 80, [paper, raised]),
    'ink-faint C=0.012 H=80 (text on paper)': textOn(0.012, 80, [paper, raised]),
    'terracotta-ink C=0.10 H=45 (text on paper)': textOn(0.1, 45, [paper, raised]),
    'oxblood-ink C=0.12 H=20 (text on paper)': textOn(0.12, 20, [paper, raised]),
    'ochre-ink C=0.09 H=80 (text on paper)': textOn(0.09, 80, [paper, raised]),
    'sage C=0.07 H=150 (text on paper)': textOn(0.07, 150, [paper, raised]),
    'terracotta FILL C=0.11 H=45 (ink label)': fillFor(0.11, 45),
    'oxblood FILL C=0.13 H=20 (ink label)': fillFor(0.13, 20),
    // Hairlines are non-text: 3:1 against the surface they sit on.
    'rule vs raised (3:1)': (() => {
      for (let L = 0.2; L <= 1; L += 0.005) {
        if (ratio(toRgb(`oklch(${L.toFixed(3)} 0.014 75)`), raised) >= 3) {
          return L.toFixed(3)
        }
      }
      return null
    })(),
  }
})

console.log(JSON.stringify(out, null, 2))
await browser.close()
