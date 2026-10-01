/**
 * One-off: find a button fill whose label clears 4.5:1, measured in-browser.
 *
 * The plan's terracotta (0.62 0.13 45) gives 3.83:1 with an ink label and
 * 1.73:1 with a white label, so the primary action button needs a fill
 * somewhere else. This searches for it rather than guessing.
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

  const ink = toRgb('oklch(0.28 0.02 60)')
  const white = toRgb('#ffffff')

  const rows = []
  for (let L = 0.4; L <= 0.8; L += 0.02) {
    const fill = toRgb(`oklch(${L.toFixed(2)} 0.13 45)`)
    rows.push({
      L: L.toFixed(2),
      ink: ratio(ink, fill).toFixed(2),
      white: ratio(white, fill).toFixed(2),
    })
  }
  return rows
})

console.log('terracotta fill candidates (label contrast):')
console.log('  L      ink-label  white-label')
for (const r of out) {
  const okInk = Number(r.ink) >= 4.5 ? 'OK ' : '   '
  const okWhite = Number(r.white) >= 4.5 ? 'OK ' : '   '
  console.log(
    `  ${r.L}   ${okInk}${r.ink.padStart(5)}   ${okWhite}${r.white.padStart(5)}`,
  )
}

await browser.close()
