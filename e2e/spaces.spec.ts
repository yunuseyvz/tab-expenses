/**
 * One account, several households.
 *
 * The tenancy model this guards: an account may own spaces it created *and*
 * belong to spaces it was invited to, and it must be able to tell them apart.
 * The part most likely to rot silently is the remembered-space default — if that
 * stops being written, every bare /dashboard quietly shows the first space, which
 * still looks correct right up until you own two.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.use({ storageState: 'test-results/auth.json' })

test.describe('space switching', () => {
  test('a second space is created, selected, and remembered across a reload', async ({
    page,
  }) => {
    // The shared session belongs to the seeded demo account.
    await page.goto('/dashboard')
    await expect(
      page.getByRole('heading', { name: 'Hauptstraße' }),
    ).toBeVisible()

    const switcher = page.locator('button[aria-haspopup=listbox]:visible')

    /**
     * Assert which household the switcher is showing.
     *
     * On the accessible name, not on the text. The mobile trigger in the
     * floating bar shows the household's mark and nothing else — four tabs and a
     * name do not fit across a phone — so it carries the name in `aria-label`.
     * That is a stronger assertion than the text was: the text is a visual
     * detail, the accessible name is what a screen reader actually announces,
     * and a switcher that silently stopped naming the household would break
     * someone who cannot see the mark at all.
     */
    const expectSwitcher = (name: string) =>
      expect(switcher).toHaveAccessibleName(new RegExp(name))

    // ── create another household ────────────────────────────────────────
    await switcher.click()
    await page.getByRole('button', { name: 'New space' }).click()
    await expect(page).toHaveURL(/\/spaces\/new/)
    await expect(page.getByRole('heading', { name: 'New space' })).toBeVisible()

    // A fresh space, so the assertions below cannot pass on stale data.
    const name = `Ferienhaus ${Date.now()}`
    await page.getByLabel('Space name').fill(name)
    await page.getByLabel('Your name in this space').fill('Vale')
    await page.getByRole('button', { name: 'Create space' }).click()

    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole('heading', { name })).toBeVisible()
    // And the switcher follows, without a reload.
    await expectSwitcher(name)

    // A brand-new space has nothing in it. If this ever shows a number it means
    // the space switched was not the new one.
    await expect(page.getByText('Total spend')).toBeVisible()

    // ── switch back ─────────────────────────────────────────────────────
    // The one place in the suite with two spaces to switch between, and so the
    // one place the household transition can be asserted: switching household is
    // the *only* thing in the app that animates, and a blur is the most
    // expensive thing in it to animate, so it is worth knowing it is still
    // attached to one event and not drifting onto tab taps.
    await switcher.click()
    const blur = watchContent(page)
    await page.getByRole('option', { name: /Hauptstraße/ }).click()
    await expect(
      page.getByRole('heading', { name: 'Hauptstraße' }),
    ).toBeVisible()

    const frames = await blur
    expect(
      Math.max(...frames.map((f) => f.blur)),
      'switching household should resolve the content out of a blur',
    ).toBeGreaterThan(0)
    expect(
      Math.min(...frames.map((f) => f.opacity)),
      'and it should arrive as a fade as well',
    ).toBeLessThan(0.9)
    expect(
      frames.some((f) => f.willChange !== 'auto'),
      'will-change should be attached while the filter animates',
    ).toBe(true)

    // Switching pins ?space= so the URL can be shared and reloaded as-is.
    await expect(page).toHaveURL(/space=/)

    // ── the remembered default is what the cookie is for ───────────────
    // The nav links deliberately carry no space, so clicking one drops the param
    // from the URL. Landing on Hauptstraße anyway can only mean the
    // remembered-space cookie was written — if it were not, every bare
    // /dashboard would quietly fall back to the first space, which still looks
    // right right up until you own two.
    await page.getByRole('link', { name: 'Balances' }).click()
    await expect(page).toHaveURL(/\/balances/)
    expect(new URL(page.url()).searchParams.get('space')).toBeNull()
    await expectSwitcher('Hauptstraße')

    await page.reload()
    expect(new URL(page.url()).searchParams.get('space')).toBeNull()
    await expect(page.getByRole('heading', { name: 'Balances' })).toBeVisible()
    await expectSwitcher('Hauptstraße')

    // ── a ?space= for someone else's space must be refused, not obeyed ──
    // resolveSpaceId ignores ids the user does not belong to. The screen has to
    // keep showing a real household rather than going blank.
    await page.goto('/balances?space=00000000-0000-4000-8000-000000000000')
    await expectSwitcher('Hauptstraße')
    await expect(page.getByRole('heading', { name: 'Balances' })).toBeVisible()
  })
})

/**
 * Watch the content wrapper's filter, opacity and will-change, frame by frame,
 * until `stop` is called. The animation is JS-driven, so it leaves no CSS
 * transition for a stylesheet assertion to find.
 *
 * The element is re-queried on every frame rather than captured once, and that
 * is load-bearing: navigating *replaces* the content wrapper, so a reference
 * taken beforehand is a detached node by the time the animation runs, and every
 * frame then reports the settled style of something no longer on the page. That
 * reads as "the animation did not happen" and is indistinguishable from a real
 * failure — which is exactly how it was mistaken for one.
 */
function watchContent(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Array<{ blur: number; opacity: number; willChange: string }>>(
        (done) => {
          const out: Array<{
            blur: number
            opacity: number
            willChange: string
          }> = []
          const t0 = performance.now()
          const tick = () => {
            const el = document.querySelector('#main')?.parentElement
            if (el) {
              const cs = getComputedStyle(el)
              out.push({
                blur: parseFloat(cs.filter.replace(/[^\d.]/g, '')) || 0,
                opacity: Number(cs.opacity),
                willChange: cs.willChange,
              })
            }
            if (performance.now() - t0 < 700) requestAnimationFrame(tick)
            else done(out)
          }
          tick()
        },
      ),
  )
}
