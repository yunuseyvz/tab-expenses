/**
 * The two period features: the "Last week" preset, and the expenses screen's
 * calendar view — a second rendering of the same filter, whose month flips are
 * period changes.
 *
 * Every date here is computed the way the app computes it, Monday-first, rather
 * than hardcoded: the seed is relative to today, so a spec that is only true on
 * the day it was written is a spec that quietly fails on Sunday.
 */
import { expect, test } from '@playwright/test'

/** The last COMPLETE week: Monday–Sunday of the week before this one. */
function lastWeek() {
  const now = new Date()
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((now.getDay() + 6) % 7) - 7,
  )
  const sunday = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 6,
  )
  return { monday, sunday }
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/** The same short form `periodLabel` prints in the dashboard header. */
function dayMonthYear(d: Date) {
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

test.describe('period + calendar', () => {
  test('"Last week" resolves to the complete Monday–Sunday week before this one', async ({
    page,
  }) => {
    const { monday, sunday } = lastWeek()

    await page.goto('/dashboard?period=all')
    await page.getByRole('radio', { name: 'Last week' }).click()

    // The URL names the preset; the dates are resolved, not passed through.
    await expect(page).toHaveURL(/period=lastWeek/)
    await expect(page.getByRole('radio', { name: 'Last week' })).toBeChecked()

    // The header states the resolved window. This is the one line that says
    // the pill means what its label claims it means — a preset that quietly
    // resolved to the wrong dates would pass every count-based assertion on
    // the seeded data and still be wrong every day of the year.
    await expect(
      page.getByText(`${dayMonthYear(monday)} – ${dayMonthYear(sunday)}`),
    ).toBeVisible()
  })

  test('the ledger under "Last week" drops everything outside the week', async ({
    page,
  }) => {
    await page.goto('/expenses?period=all')
    // Seeded 40 days back, so always outside a seven-day window.
    await expect(page.getByText('Previous rent')).toBeVisible()

    await page.getByRole('radio', { name: 'Last week' }).click()
    await expect(page).toHaveURL(/period=lastWeek/)
    await expect(page.getByText('Previous rent')).toHaveCount(0)
  })

  test('the view toggle switches renderings of the same filter', async ({
    page,
  }) => {
    await page.goto('/expenses?period=thisMonth')
    const row = page.locator('main button[aria-label^="Edit "]')
    await row.first().waitFor({ state: 'visible' })

    await page.getByRole('radio', { name: 'Calendar' }).click()
    await expect(page).toHaveURL(/view=calendar/)
    const thisMonth = new Intl.DateTimeFormat('en', {
      month: 'long',
      year: 'numeric',
    }).format(new Date())
    await expect(
      page.getByRole('grid', { name: `${thisMonth} calendar` }),
    ).toBeVisible()

    // The filter survives the switch: it is the same query, differently drawn.
    await page.getByRole('radio', { name: 'List' }).click()
    await expect(page).toHaveURL(/view=list/)
    await expect(row.first()).toBeVisible()
  })

  test('a day with entries opens under the grid, and closes on a second tap', async ({
    page,
  }) => {
    /*
     * The month that contains "Weekly groceries" (seeded one day back), named
     * explicitly rather than defaulting to this month: on the first of a month
     * every seeded day is in the previous one, and a test that assumes the
     * current month has data in it is a test that fails for a week at a time.
     */
    const anchor = new Date()
    anchor.setDate(anchor.getDate() - 1)
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
    await page.goto(
      `/expenses?view=calendar&period=custom&from=${iso(from)}&to=${iso(to)}`,
    )

    const monthName = new Intl.DateTimeFormat('en', {
      month: 'long',
      year: 'numeric',
    }).format(from)
    const grid = page.getByRole('grid', { name: `${monthName} calendar` })
    await expect(grid).toBeVisible()

    // A day with spend announces its entries; one of them opens the day.
    // `entr(y|ies)`, not `entries?` — the latter is "entrie" with an optional
    // s and never matches "1 entry", which is what most seeded days say.
    const day = grid.getByRole('gridcell', { name: /, \d+ entr(y|ies)/ }).first()
    await day.click()
    const panel = page.getByRole('region', { name: /^Entries on/ })
    await expect(panel).toBeVisible()

    // The day's rows are the ledger's rows, not a calendar-specific copy.
    await expect(
      panel
        .locator('button[aria-label^="Edit "], button[aria-label^="View "]')
        .first(),
    ).toBeVisible()

    // Tapping the chosen day again closes it, like a disclosure.
    await day.click()
    await expect(panel).toHaveCount(0)
  })

  test('flipping a month is a period change: the pills move with the calendar', async ({
    page,
  }) => {
    await page.goto('/expenses?view=calendar&period=thisMonth')

    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const last = new Date(now.getFullYear(), now.getMonth() + 2, 0)

    await page.getByRole('button', { name: 'Next month' }).click()

    // The URL says the month, as dates — so the calendar view is as shareable
    // as the statement beside it, and flipping does not depend on client state.
    await expect(page).toHaveURL(/period=custom/)
    await expect(page).toHaveURL(new RegExp(`from=${iso(next)}`))
    await expect(page).toHaveURL(new RegExp(`to=${iso(last)}`))

    // The pill row agrees: the window is Custom now, named by its dates.
    await expect(page.getByRole('radio', { name: 'Custom' })).toBeChecked()

    // And the grid moved with it.
    const nextName = new Intl.DateTimeFormat('en', {
      month: 'long',
      year: 'numeric',
    }).format(next)
    await expect(
      page.getByRole('grid', { name: `${nextName} calendar` }),
    ).toBeVisible()
  })
})
