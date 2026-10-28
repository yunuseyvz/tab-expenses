/**
 * Getting from a category's total to the entries behind it.
 *
 * The report this is for: selecting a category showed an amount and nothing
 * else. The filter worked, the totals moved, and "Recent entries" showed eight
 * rows of it with no way to reach the rest — so a breakdown was a dead end. The
 * capability to list a category's entries had been in the ledger route the whole
 * time, reachable only by hand-editing the URL, which is a door with no handle.
 *
 * Two halves, and they are separate because either can work alone:
 *
 *   1. A number you can press. The by-category bars open the ledger on that
 *      category, carrying the period and the household across, because landing on
 *      "all time" when you were reading October is worse than no drill-down at
 *      all — the figure you clicked no longer matches the list you get.
 *
 *   2. A control on the destination. The chips on the ledger write the same
 *      `cats` parameter the ledger already filtered by.
 *
 * Plus the paging, which is not optional polish. A category drill-down is the
 * most likely way to reach the row limit, so a filter that leads to a silently
 * truncated list is a lie the new feature would have shipped with. The header
 * states the range and the page's own sum says which figure it is.
 */
import { expect, test } from '@playwright/test'

/*
 * Every entry row, whether it opens editable or read-only.
 *
 * A locked expense still opens — as a view — and its label starts "View", so a
 * selector for "Edit" alone silently counts zero on a ledger of locked entries.
 */
const entryRow =
  'main button[aria-label^="Edit "], main button[aria-label^="View "]'

test.describe('category drill-down', () => {
  test('a category bar opens the ledger on that category', async ({ page }) => {
    await page.goto('/dashboard?period=all')

    const bar = page
      .locator('[data-testid="by-category"] button')
      .filter({ hasText: 'Groceries' })
    await expect(bar).toBeVisible()

    // The period has to survive the crossing. Navigating to the unfiltered
    // ledger would put a different set of entries under a figure the reader just
    // decided was about groceries.
    //
    // "This month" rather than last: the seeded household has groceries this
    // month and none last, so last month has no Groceries bar to click and the
    // test would sit on a locator that can never resolve. That is a fixture
    // fact, not a behaviour, and it is worth the comment because the failure
    // reads as a timeout on a navigation that works.
    await page.goto('/dashboard?period=thisMonth')
    await page
      .locator('[data-testid="by-category"] button')
      .filter({ hasText: 'Groceries' })
      .click()

    await expect(page).toHaveURL(/\/expenses/)
    await expect(page).toHaveURL(/period=thisMonth/)
    await expect(page).toHaveURL(/cats=/)
    await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible()
  })

  test('every entry on the page is in the category that was clicked', async ({
    page,
  }) => {
    await page.goto('/dashboard?period=all')
    await page
      .locator('[data-testid="by-category"] button')
      .filter({ hasText: 'Groceries' })
      .click()
    await page.waitForTimeout(600)

    const rows = page.locator(entryRow)
    const n = await rows.count()
    expect(n).toBeGreaterThan(0)

    // Every row carries its category as text, and none of them may be another
    // category. A filter that leaks rows is worse than no filter, because the
    // total above it would then be describing a set the reader cannot see.
    const texts = await rows.allInnerTexts()
    const wrong = texts.filter(
      (t) => !/Groceries/.test(t) && !/split \d+ ways/.test(t),
    )
    expect(wrong, `rows outside Groceries: ${wrong.join(' | ')}`).toEqual([])
  })

  test('the ledger has category chips, and they round-trip through the URL', async ({
    page,
  }) => {
    await page.goto('/expenses?period=all')
    const chips = page.locator('[data-testid="category-chips"] button')
    await expect(chips.first()).toBeVisible()

    /*
     * Nothing chosen reads as every chip pressed, because "All" does mean every
     * category is in the filter.
     */
    const groceries = chips.filter({ hasText: 'Groceries' }).first()
    await expect(groceries).toHaveAttribute('aria-pressed', 'true')

    /*
     * And the first press ISOLATES rather than removing it from an implicit
     * everything. It used not to: under All a press meant "everything except
     * groceries", which is the opposite of what a reader who has just looked at a
     * groceries total is asking for — and the opposite of what the by-category
     * bars now do when they hand you a category.
     */
    await groceries.click()
    await expect(page).toHaveURL(/cats=/)
    await expect(groceries).toHaveAttribute('aria-pressed', 'true')
    await expect(chips.filter({ hasText: 'Health' }).first()).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    // Only groceries is listed, so the figure above the list and the list agree.
    const rows = page.locator(entryRow)
    expect(await rows.count()).toBeGreaterThan(0)
    const wrong = (await rows.allInnerTexts()).filter(
      (t) => !/Groceries/.test(t) && !/split \d+ ways/.test(t),
    )
    expect(wrong, `rows outside Groceries: ${wrong.join(' | ')}`).toEqual([])

    // And the same URL, typed directly, is the state. The chips are a control for
    // a parameter the route already honoured; if the URL did not reproduce the
    // screen then the control would be a shortcut into a private state rather
    // than a way of expressing one.
    const url = page.url()
    const fresh = await page.context().newPage()
    await fresh.goto(url)
    await expect(
      fresh
        .locator('[data-testid="category-chips"] button')
        .filter({
          hasText: 'Groceries',
        })
        .first(),
    ).toHaveAttribute('aria-pressed', 'true')
    await fresh.close()

    // Adding a second category widens it, rather than emptying it.
    await chips.filter({ hasText: 'Health' }).first().click()
    await expect(chips.filter({ hasText: 'Health' }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(groceries).toHaveAttribute('aria-pressed', 'true')

    // All puts everything back and takes the parameter out of the URL.
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(page).not.toHaveURL(/cats=/)
  })

  test('the header states the range, and the pager exists exactly when it is not the whole set', async ({
    page,
  }) => {
    /*
     * Asserted as a pairing rather than as two fixed expectations, because the
     * size of the ledger is not this test's to know. Another spec's import leaves
     * sixty rows behind, and a test that said "no pager" because the seeded
     * household is small would start failing for a reason that has nothing to do
     * with the pager.
     *
     * The invariant is the one that matters: the header never claims to be showing
     * everything when it is not, and the page furniture appears exactly when the
     * range is partial.
     */
    await page.goto('/expenses?period=all')
    const header = page.locator('p.text-xs').first()
    await expect(header).toHaveText(
      /^\d+ entries · €|^Showing \d+–\d+ of \d+ · /,
    )

    const whole = await header.innerText()
    const pager = page.getByRole('navigation', { name: 'Ledger pages' })

    if (/^Showing /.test(whole)) {
      // A partial range says so, says whose page it is, and says the money is
      // this page's.
      expect(whole).toMatch(/on this page$/)
      await expect(pager).toBeVisible()
      await expect(pager.getByText(/Page 1 of \d+/)).toBeVisible()
      // And the range is a real range within the total.
      const m = whole.match(/Showing (\d+)–(\d+) of (\d+)/)!
      expect(Number(m[1])).toBe(1)
      expect(Number(m[2])).toBeLessThanOrEqual(Number(m[3]))
    } else {
      expect(whole).not.toContain('on this page')
      await expect(pager).toHaveCount(0)
    }
  })

  test('a day split across two pages still states its whole total', async ({
    page,
  }) => {
    /*
     * The report this exists for, stated as a test.
     *
     * "When I look at a day on expenses it matches my own arithmetic, but when the
     * app adds the days up it does something weird." The day header used to be
     * summed in the browser from whatever rows the query returned, while the period
     * total above it was summed in SQL over the whole filter. Same set while the
     * list was small; different set the moment it was capped — and it was capped at
     * 200 with nothing on screen saying so. So each day a reader could see was
     * correct, and the sum of them was short, by exactly the rows that had been
     * dropped.
     *
     * A single day with more entries than fit on a page is the sharpest version of
     * that: page one shows part of the day, and its header must still be the whole
     * day.
     */
    await page.goto('/settings')
    await page
      .getByRole('button', { name: /Import from a spreadsheet/ })
      .click()
    await expect(page.getByLabel('CSV contents')).toBeVisible()

    const run = Date.now().toString(36)
    /*
     * A date of its own per run.
     *
     * A fixed day accumulates sixty more rows every time the suite runs, and the
     * assertion below would then be comparing one run's sixty against three runs'
     * hundred and eighty. Spread across year, month and day so consecutive runs
     * land in different places; a collision is a loud failure rather than a quiet
     * pass, because the count assertion comes first.
     */
    const stamp = Date.now()
    // Division, not `>>`. A millisecond timestamp exceeds 32 bits, and `>>`
    // coerces it to int32 — which for this value is negative, so `% 28` came back
    // negative and the date was written as `2041-02--11`, which the importer
    // rejected sixty times over with a message about a bad date.
    /*
     * A PAST year, and that is not incidental.
     *
     * These entries go into the shared demo household, and the ledger is
     * newest-first. Sixty rows dated in the future sort above everything the rest
     * of the suite expects to find on the first page — the seeded expenses, and the
     * entry another spec creates and reloads. So the rows go into the past, where
     * they extend the ledger without displacing what other specs look for.
     *
     * Unique per run regardless: a repeated date accumulates another sixty rows
     * every time the suite runs.
     */
    const year = 2000 + (stamp % 20)
    const month = 1 + (stamp % 12)
    const day = 1 + (Math.floor(stamp / 128) % 28)
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const COUNT = 60
    // One euro each, so the day's total is a round sixty and any partial sum is
    // obvious at a glance rather than a difference of a rounding unit.
    const AMOUNT = 1
    const rows = Array.from(
      { length: COUNT },
      (_, i) =>
        `${date},Split day ${run} ${i},${AMOUNT.toFixed(2)},Health,Sam,`,
    )
    await page
      .getByLabel('CSV contents')
      .fill(['date,purpose,amount,category,paid_by,note', ...rows].join('\n'))
    await page.getByRole('button', { name: 'Preview' }).click()
    await page.getByRole('button', { name: /^Import \d+ row/ }).click()
    await expect(page.getByText(/Imported \d+ row/)).toBeVisible()

    // Filtered to that one day, so it is one page and its header must be the sum
    // of all sixty.
    await page.goto(`/expenses?space=&period=custom&from=${date}&to=${date}`)
    /*
     * The day heading and its figure are siblings in one row, and the chip
     * strip's "Categories" is an h2 too — so the day row is read straight out of
     * the DOM as the first heading row that carries money, rather than through a
     * locator that has to be told which of the two it means.
     */
    const dayRow = await page.evaluate<string>(`(() => {
      const row = Array.from(document.querySelectorAll('main h2'))
        .map((h) => h.parentElement)
        .find((p) => p && /€/.test(p.textContent || ''))
      return row ? (row.textContent || '').trim() : ''
    })()`)

    // Sixty euros, and fifty rows on the page. That gap IS the bug being guarded:
    // before the fix the heading was summed from the loaded rows and would have
    // read €50.00, so a reader adding up the day figures got a total the app
    // itself contradicted.
    expect(dayRow, 'the day heading must state the whole day').toContain(
      '€60.00',
    )
    expect(await page.locator(entryRow).count()).toBe(50)
  })

  test('a ledger bigger than one page pages, and says which page it is', async ({
    page,
  }) => {
    /*
     * The fixture household has seventeen entries, which is under a page — so
     * this test cannot reach the pager by looking. It creates its own second page
     * with the CSV importer, which is the honest way to get there: fifty-odd rows
     * typed through the sheet one at a time would take longer than the whole
     * suite.
     *
     * And that is the point of the pager being tested here at all. The category
     * drill-down above is the most likely way a household reaches this limit, so a
     * filter that led to a silently truncated list would ship the new feature on
     * top of a lie.
     */
    await page.goto('/settings')
    await page
      .getByRole('button', { name: /Import from a spreadsheet/ })
      .click()
    await expect(page.getByLabel('CSV contents')).toBeVisible()

    /*
     * A marker per run, in the purpose.
     *
     * The importer skips rows it has already seen, so fixed purposes make this
     * test pass exactly once and then find nothing to import — which reads as a
     * broken button rather than as a test that ran before. With a marker, every
     * run creates its own sixty and the assertion after it holds whatever the
     * database happens to contain.
     */
    const run = Date.now().toString(36)
    /*
     * JULY, and specifically not June.
     *
     * The csv-import spec asserts on rows it imported in June and finds them by
     * their text. Sixty extra rows in the same month push those onto page two and
     * break a test that has nothing to do with paging — so the two suites are given
     * separate months rather than one being made tolerant of the other.
     *
     * Distinct dates within the month so the day-grouping has something to group
     * and the rows are spread rather than stacked on a single day.
     */
    const rows = Array.from({ length: 60 }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, '0')
      // 2019, for the same reason as the split-day test: past-dated rows extend
      // the ledger instead of pushing other specs' rows off the first page.
      return `2019-07-${day},Paged ${run} row ${i},${(i + 1) * 0.5},Groceries,Alex,`
    })
    await page
      .getByLabel('CSV contents')
      .fill(['date,purpose,amount,category,paid_by,note', ...rows].join('\n'))
    await page.getByRole('button', { name: 'Preview' }).click()
    await page.getByRole('button', { name: /^Import \d+ row/ }).click()

    /*
     * Wait for the import to actually land.
     *
     * Navigating straight afterwards reads the ledger before the mutation has
     * committed, and gets a count from before the rows existed — which is a
     * perfectly plausible number and the assertion then fails on a race rather
     * than on a defect. The success toast is the only signal that the write is
     * done, so it is what the test waits for.
     */
    await expect(page.getByText(/Imported \d+ row/)).toBeVisible()

    /*
     * Filtered to the category these rows went into, so the assertion is about the
     * pager rather than about however much else the ledger happens to hold. Sixty
     * rows is enough on its own to force a second page.
     */
    await page.goto('/expenses?period=all&space=')
    const groceriesChip = page
      .locator('[data-testid="category-chips"] button')
      .filter({ hasText: 'Groceries' })
      .first()
    await groceriesChip.click()
    await expect(page).toHaveURL(/cats=/)
    const header = page.locator('p.text-xs').first()
    await expect(header).toHaveText(
      /^Showing \d+–\d+ of \d+ · €[\d.,]+ on this page$/,
    )

    const pager = page.getByRole('navigation', { name: 'Ledger pages' })
    await expect(pager).toBeVisible()
    await expect(pager.getByText(/Page 1 of \d+/)).toBeVisible()

    const firstBefore = await page.locator(entryRow).first().innerText()
    await pager.getByRole('button', { name: 'Older' }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(pager.getByText(/Page 2 of \d+/)).toBeVisible()
    await page.waitForTimeout(600)
    expect(await page.locator(entryRow).first().innerText()).not.toBe(
      firstBefore,
    )

    // A page is a URL, so it is a thing you can send somebody.
    const page2 = page.url()
    const fresh = await page.context().newPage()
    await fresh.goto(page2)
    await expect(
      fresh
        .getByRole('navigation', { name: 'Ledger pages' })
        .getByText(/Page 2 of/),
    ).toBeVisible()
    await fresh.close()

    await pager.getByRole('button', { name: 'Newer' }).click()
    await expect(page).not.toHaveURL(/page=2/)
  })
})
