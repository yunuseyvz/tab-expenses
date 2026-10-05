/**
 * Repeating expenses: creating one, catching up, and stopping it.
 *
 * This spec reads the database directly, which no other spec does, and the reason
 * is that the behaviour worth testing is not visible on screen. Materialisation
 * runs on read and is only correct because a unique index refuses the second
 * insert, so the interesting assertions are "there are exactly three rows, with
 * three distinct occurrence keys, and there are still three after another read".
 * A UI assertion cannot see the difference between one row and a duplicate that
 * the list happened to collapse.
 *
 * The date picker is also not usable for this: catch-up needs a series anchored
 * in the past, and the only way to produce one is to move the template's cursor
 * back. That is a legitimate thing to do to a test database, and it is the same
 * move the passage of time makes on its own.
 */
import { execSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const MONTHLY = 'E2E repeating rent'
const WEEKLY = 'E2E repeating milk'

/**
 * Run a query against the same Postgres the app is using.
 *
 * `-tA` for a bare, unaligned value, so a scalar query returns exactly what a
 * string comparison expects. The suite already requires the whole compose stack
 * to be up for Mailpit and the app itself, so this adds a dependency that is
 * already there rather than introducing one.
 */
function psql(sql: string): string {
  return execSync(
    `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T db psql -U app -d app -tAc ${JSON.stringify(sql)}`,
    { encoding: 'utf8' },
  ).trim()
}

const clean = (purpose: string) => {
  psql(`delete from expense where purpose = '${purpose}'`)
  psql(`delete from recurring_expense where purpose = '${purpose}'`)
}

/** Create a repeating expense through the sheet, on today's date. */
async function createSeries(
  page: Page,
  purpose: string,
  frequency: 'Monthly' | 'Weekly',
) {
  await page.goto('/dashboard?period=all')
  await page.getByRole('button', { name: 'New expense' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()

  await page.getByLabel('Amount').fill('900.00')
  await page.getByLabel('What was it for').fill(purpose)
  await sheet.getByRole('radio', { name: frequency }).click()
  await page.getByRole('radio', { name: 'Alex paid' }).locator('..').click()
  await sheet.getByRole('button', { name: /Save/ }).click()
  await expect(sheet).toBeHidden()
}

const keysFor = (purpose: string) =>
  psql(
    `select string_agg(coalesce(period_key, 'null'), ',' order by spent_on) from expense where purpose = '${purpose}'`,
  )

const countFor = (purpose: string) =>
  Number(psql(`select count(*) from expense where purpose = '${purpose}'`))

test.describe('repeating expenses', () => {
  test.beforeEach(() => {
    clean(MONTHLY)
    clean(WEEKLY)
  })

  test.afterEach(() => {
    clean(MONTHLY)
    clean(WEEKLY)
  })

  test('makes one entry a month, and catches up on the ones it missed', async ({
    page,
  }) => {
    await createSeries(page, MONTHLY, 'Monthly')

    // The series exists with today's day as its anchor, and the entry that
    // created it is already its first occurrence — not a separate seed row that
    // repeats, which is the version that produces two rents in month one.
    expect(
      psql(
        `select frequency || '|' || anchor_day::text from recurring_expense where purpose = '${MONTHLY}'`,
      ),
    ).toBe(`monthly|${new Date().getDate()}`)
    expect(countFor(MONTHLY)).toBe(1)
    expect(keysFor(MONTHLY)).toMatch(/^\d{4}-\d{2}$/)

    // Three months behind, as if nobody had opened the app since. Two of these
    // are genuinely due and have to be created; the third is the one already
    // there and must be refused.
    psql(
      `update recurring_expense set next_due_on = (starts_on - interval '2 months')::date where purpose = '${MONTHLY}'`,
    )
    await page.reload()
    await expect(page.getByText(MONTHLY, { exact: true }).first()).toBeVisible()

    expect(countFor(MONTHLY)).toBe(3)
    expect(keysFor(MONTHLY).split(',')).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\d{4}-\d{2}$/)]),
    )
    // Three distinct months — not three rows sharing a key, which is what a
    // collision would look like.
    expect(new Set(keysFor(MONTHLY).split(',')).size).toBe(3)

    // And the read that follows must add nothing. This is the assertion the
    // unique index exists for: the same read ran twice.
    await page.reload()
    await expect(page.getByText(MONTHLY, { exact: true }).first()).toBeVisible()
    expect(countFor(MONTHLY)).toBe(3)
  })

  test('the generated entries are ordinary entries, and say they repeat', async ({
    page,
  }) => {
    await createSeries(page, MONTHLY, 'Monthly')
    psql(
      `update recurring_expense set next_due_on = (starts_on - interval '1 month')::date where purpose = '${MONTHLY}'`,
    )
    await page.reload()
    await expect(page.getByText(MONTHLY, { exact: true }).first()).toBeVisible()

    // Each occurrence is a normal expense with its own split — not a view over
    // the series. Edited one, the others must not move.
    expect(
      psql(
        `select count(*) from expense_split s join expense e on e.id = s.expense_id where e.purpose = '${MONTHLY}'`,
      ),
    ).toBe('2')
    // Attributed and locked like a typed entry, so a generated rent arrives
    // protected and legible as somebody's.
    expect(
      psql(
        `select bool_and(locked)::text from expense where purpose = '${MONTHLY}'`,
      ),
    ).toBe('true')

    await page.getByText(MONTHLY, { exact: true }).first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByText('Repeats every month')).toBeVisible()
    // The schedule is not editable from an occurrence: correcting one month must
    // not decide every future month.
    await expect(sheet.getByRole('radiogroup', { name: 'Repeat' })).toHaveCount(
      0,
    )
  })

  test('stopping the series keeps the old entries and stops the new ones', async ({
    page,
  }) => {
    await createSeries(page, MONTHLY, 'Monthly')
    psql(
      `update recurring_expense set next_due_on = (starts_on - interval '2 months')::date where purpose = '${MONTHLY}'`,
    )
    await page.reload()
    await expect(page.getByText(MONTHLY, { exact: true }).first()).toBeVisible()
    expect(countFor(MONTHLY)).toBe(3)

    await page.getByText(MONTHLY, { exact: true }).first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByText('Repeats every month')).toBeVisible()
    await sheet.getByRole('button', { name: 'Stop repeating' }).click()
    await expect(sheet.getByText('Repeats every month')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    expect(
      psql(
        `select (archived_at is not null)::text from recurring_expense where purpose = '${MONTHLY}'`,
      ),
    ).toBe('true')

    // Wind the cursor back again. A stopped series must not resume, and the three
    // entries it already made must still be there — stopping is not deleting.
    psql(
      `update recurring_expense set next_due_on = (starts_on - interval '5 months')::date where purpose = '${MONTHLY}'`,
    )
    await page.reload()
    await expect(page.getByText(MONTHLY, { exact: true }).first()).toBeVisible()
    expect(countFor(MONTHLY)).toBe(3)
  })

  test('weekly repeats are keyed by ISO week', async ({ page }) => {
    await createSeries(page, WEEKLY, 'Weekly')
    psql(
      `update recurring_expense set next_due_on = (starts_on - interval '21 days')::date where purpose = '${WEEKLY}'`,
    )
    await page.reload()
    await expect(page.getByText(WEEKLY, { exact: true }).first()).toBeVisible()

    // Four weeks, four distinct keys, in order.
    expect(countFor(WEEKLY)).toBe(4)
    const keys = keysFor(WEEKLY).split(',')
    expect(keys.every((k) => /^\d{4}-W\d{2}$/.test(k))).toBe(true)
    expect(new Set(keys).size).toBe(4)

    // Re-read: still four. A week boundary is where a home-grown week counter
    // collides two occurrences into one key and one of them vanishes.
    await page.reload()
    await expect(page.getByText(WEEKLY, { exact: true }).first()).toBeVisible()
    expect(countFor(WEEKLY)).toBe(4)
  })
})
