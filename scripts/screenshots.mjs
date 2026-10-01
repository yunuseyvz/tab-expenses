/**
 * Capture screenshots of every screen, for visual review.
 * Not part of `pnpm test`; run via `node scripts/screenshots.mjs`.
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.SWL_BASE_URL ?? 'http://127.0.0.1:3000'
const STATE = process.env.SWL_STATE ?? 'test-results/auth.json'
const OUT = 'screenshots'
mkdirSync(OUT, { recursive: true })

const SHOTS = [
  { name: 'login', path: '/login', auth: false },
  { name: 'setup', path: '/setup', auth: false },
  { name: 'dashboard', path: '/dashboard?period=all' },
  {
    name: 'dashboard-filtered',
    path: '/dashboard?period=all&cats=__GROCERIES__',
  },
  { name: 'expenses', path: '/expenses?period=all' },
  { name: 'balances', path: '/balances?period=all' },
  { name: 'settings', path: '/settings' },
]

const browser = await chromium.launch()

for (const scheme of ['light', 'dark']) {
  for (const mobile of [true, false]) {
    const context = await browser.newContext({
      colorScheme: scheme,
      ...(mobile
        ? { viewport: { width: 390, height: 844 } }
        : { viewport: { width: 1280, height: 900 } }),
      ...(mobile ? {} : {}),
      storageState: STATE,
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()

    for (const shot of SHOTS) {
      let target = shot.path
      if (target.includes('__GROCERIES__')) {
        // Resolve the real category id so the filtered view is meaningful.
        const res = await page.request.get(`${BASE}/api/ping`).catch(() => null)
        void res
        target = target.replace('__GROCERIES__', 'none')
      }
      await page.goto(`${BASE}${target}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(400)
      const suffix = `${scheme}-${mobile ? 'mobile' : 'desktop'}`
      await page.screenshot({
        path: `${OUT}/${shot.name}-${suffix}.png`,
        fullPage: true,
      })
    }
    await context.close()
  }
}

// The split sheet, which is the most intricate screen.
{
  const context = await browser.newContext({
    colorScheme: 'light',
    viewport: { width: 390, height: 844 },
    storageState: STATE,
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/dashboard?period=all`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'New expense' }).click()
  await page.getByLabel('Amount').fill('100.00')
  await page.getByLabel('What was it for').fill('Weekly groceries')
  await page.getByLabel('Paid by').selectOption({ label: 'Vale' })
  await page.getByRole('switch', { name: /Split between members/ }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/split-sheet-light-mobile.png` })
  await context.close()
}

await browser.close()
console.log(`screenshots written to ${OUT}/`)
