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
import type { Page, Request } from '@playwright/test'

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

    // Scoped to the navigation landmark rather than matched by role alone: the
    // expenses screen has a second visible listbox trigger (the member filter),
    // so `button[aria-haspopup=listbox]:visible` is ambiguous once this test
    // navigates there.
    const switcher = page
      .getByRole('navigation', { name: 'Main' })
      .locator('button[aria-haspopup=listbox]')

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

    // ── and it must survive a section change ────────────────────────────
    // This is the reported failure: switch household, then tap a tab, and the
    // household silently reverts to the one before.
    //
    // The nav links carry no `?space=`, so a section change is the one
    // navigation that has to resolve the household from the remembered value
    // alone. The switcher used to write the cookie and then *read it back*
    // through the query cache before navigating, which left a window where the
    // cache still held the previous household — and a tab tapped inside that
    // window rendered the wrong one's numbers. The switcher now writes the value
    // it just set straight into the cache and navigates without waiting.
    await expectSwitcher(name)
    await page.getByRole('link', { name: 'Expenses' }).click()
    await expect(page).toHaveURL(/expenses/)
    // No `space` in the URL any more — that is the point of the assertion: the
    // household can only be right here if the remembered value is.
    expect(new URL(page.url()).searchParams.get('space')).toBeNull()
    await expectSwitcher(name)
    await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible()

    // And back to the dashboard, still the same household.
    await page.getByRole('link', { name: 'Dashboard' }).click()
    await expect(page).toHaveURL(/dashboard/)
    await expectSwitcher(name)

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
/**
 * `Secure` follows the request's protocol, not NODE_ENV.
 *
 * This is the whole reason switching households appeared to work on localhost
 * and silently fail everywhere else. `Secure` was derived from
 * `NODE_ENV === 'production'`, so a production build served over plain HTTP sent
 * a `Secure` cookie — and a browser refuses to *store* one over plain HTTP on an
 * origin that is not a secure context. Chromium calls localhost a secure context,
 * so localhost kept the cookie and every other hostname dropped it. Nothing threw:
 * the response looked correct, and the only symptom was that a household switch
 * reverted the next time you changed section.
 *
 * Both branches are asserted, because the fix has two halves and the wrong half
 * of each is invisible here. Over plain HTTP there must be no `Secure`, or the
 * cookie cannot be stored at all. Behind the proxy there must *be* one, or the
 * cookie would travel in the clear on the deployment it exists for.
 */
test.describe('the space cookie', () => {
  test('is stored over plain HTTP and marked Secure behind the proxy', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await expect(
      page.getByRole('heading', { name: 'Hauptstraße' }),
    ).toBeVisible()

    const switcher = page
      .getByRole('navigation', { name: 'Main' })
      .locator('button[aria-haspopup=listbox]')
      .first()

    // Capture the real call rather than reconstructing one: the server function's
    // URL is a build hash and its body is a serialised envelope, so replaying the
    // request the browser actually made is the only version of this that does not
    // need to know either.
    //
    // Matched by *response* rather than by being the first POST seen. Several
    // server functions here are POSTs — reading the remembered household is one,
    // deliberately, so it can never be cached — so "the first POST after load" is
    // the wrong request and silently replays a getter that sets no cookie.
    const writesCookie = new Set<string>()
    page.on('response', async (r) => {
      if ((await r.allHeaders())['set-cookie']?.includes('swl-space')) {
        writesCookie.add(r.request().url())
      }
    })
    const seen: Array<Request> = []
    page.on('request', (r) => {
      if (r.url().includes('/_serverFn/')) seen.push(r)
    })

    // Pick a household that is *not* the current one, by name rather than by
    // position. Index 1 is only meaningful when the account has exactly two
    // spaces, and an account that has made a few by hand would silently turn
    // this into a test that switches to whichever space happens to be second.
    const current = (await switcher.getAttribute('aria-label')) ?? ''
    await switcher.click()
    const options = page.getByRole('option')
    const count = await options.count()
    let target = ''
    let index = -1
    for (let i = 0; i < count; i++) {
      const label = (await options.nth(i).innerText()).split('\n')[0]!.trim()
      if (label && !current.includes(label)) {
        target = label
        index = i
        break
      }
    }
    expect(
      index,
      'the account needs a second household to switch to',
    ).toBeGreaterThanOrEqual(0)
    await options.nth(index).scrollIntoViewIfNeeded()
    await options.nth(index).click()
    await expect(page.getByRole('heading', { name: target })).toBeVisible()
    expect(
      new URL(page.url()).searchParams.get('space'),
      'a switch is only a switch if the URL names the household',
    ).not.toBeNull()

    const call = seen.find(
      (r) => r.method() === 'POST' && writesCookie.has(r.url()),
    )
    expect(
      call,
      'switching a household must POST a server function that writes the cookie',
    ).toBeTruthy()
    expect(call!.postData(), 'and must carry a body to replay').toBeTruthy()

    /**
     * Replay the captured call, optionally as though a proxy had terminated TLS.
     *
     * Two header-reading traps, both of which fail in ways that have nothing to
     * do with cookies:
     *
     *   • replaying with `request.headers()` is refused by Start's CSRF guard.
     *     It checks `Sec-Fetch-Site` first and falls back to Origin, then Referer;
     *     `headers()` omits the `sec-fetch-*` set, and a request with none of the
     *     three comes back a bare 403 "Forbidden".
     *   • reading the reply with `headers()` instead of `headersArray()` drops
     *     `set-cookie`, so the cookie would look absent even though it arrived.
     */
    const headers = async (extra: Record<string, string>) => {
      const res = await page.request.post(call!.url(), {
        headers: {
          ...(await call!.allHeaders()),
          ...extra,
        },
        data: call!.postData()!,
      })
      expect(
        res.status(),
        'the replayed call must be accepted, not rejected by the CSRF guard',
      ).toBe(200)
      return res
        .headersArray()
        .filter((h) => h.name.toLowerCase() === 'set-cookie')
        .map((h) => h.value)
        .join('\n')
    }

    const overHttp = await headers({})
    expect(overHttp, 'the server must set the space cookie').toContain(
      'swl-space',
    )
    expect(
      overHttp,
      'over plain HTTP a Secure cookie is refused by the browser, so the ' +
        'household switch cannot be remembered at all',
    ).not.toMatch(/;\s*secure/i)

    const overProxy = await headers({ 'x-forwarded-proto': 'https' })
    expect(
      overProxy,
      'Traefik terminates TLS in front of the app, so the cookie must still be ' +
        'marked Secure when the request arrived over HTTPS',
    ).toMatch(/;\s*secure/i)
  })
})

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
