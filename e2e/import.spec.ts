/**
 * CSV import through the UI: preview, refusal, and commit.
 *
 * The import is the migration path off the spreadsheet, so the property that
 * matters most is that a bad file changes nothing at all.
 */
import { expect, test } from '@playwright/test'

const HEADER = 'date,purpose,amount,category,paid_by,note'

test.describe('csv import', () => {
  test('reports problems and imports nothing', async ({ page }) => {
    await page.goto('/settings')

    await page
      .getByLabel('CSV contents')
      .fill(
        [
          HEADER,
          '2026-03-01,Good row,10.00,Groceries,Vater,',
          'not-a-date,Bad date,10.00,Groceries,Vater,',
          '2026-03-03,Another good row,5.00,Groceries,Vater,',
        ].join('\n'),
      )

    await page.getByRole('button', { name: 'Preview' }).click()

    // The problem is named with a line number, and the user is told nothing
    // will be imported.
    await expect(
      page.getByText(/problem\(s\) — nothing will be imported/),
    ).toBeVisible()
    await expect(page.getByText(/Line 3: bad or missing date/)).toBeVisible()

    // Crucially, no commit button appears while there are problems.
    await expect(
      page.getByRole('button', { name: /^Import \d+ row/ }),
    ).toHaveCount(0)
  })

  test('refuses a row whose payer is not a member', async ({ page }) => {
    await page.goto('/settings')

    await page
      .getByLabel('CSV contents')
      .fill(
        [
          HEADER,
          '2026-03-01,Mystery expense,10.00,Groceries,Nonexistent Person,',
        ].join('\n'),
      )

    await page.getByRole('button', { name: 'Preview' }).click()
    await expect(
      page.getByText(/no member named "Nonexistent Person"/),
    ).toBeVisible()
  })

  test('previews a clean file, then imports it', async ({ page }) => {
    await page.goto('/settings')

    // Timestamped so re-running the suite does not collide with the
    // duplicate check, which is itself part of what is being tested.
    const stamp = Date.now()
    await page
      .getByLabel('CSV contents')
      .fill(
        [
          HEADER,
          `2026-05-0${(stamp % 9) + 1},Imported groceries ${stamp},12.34,Groceries,Vater,from a sheet`,
          `2026-05-0${(stamp % 8) + 1},Imported pharmacy ${stamp},23.70,Health,Vale,`,
        ].join('\n'),
      )

    await page.getByRole('button', { name: 'Preview' }).click()

    // A clean file offers a commit, and names any categories it would create.
    await expect(page.getByText(/row\(s\) ready to import/)).toBeVisible()
    const commit = page.getByRole('button', { name: /^Import \d+ row/ })
    await expect(commit).toBeVisible()

    await commit.click()
    await expect(page.getByText(/Imported 2 row\(s\)/)).toBeVisible()

    // And the rows really landed in the ledger.
    await page.goto(`/expenses?period=all&space=`)
    await expect(page.getByText(`Imported groceries ${stamp}`)).toBeVisible()
  })

  test('a second import of the same file skips the duplicates', async ({
    page,
  }) => {
    await page.goto('/settings')

    const stamp = Date.now()
    const csv = [
      HEADER,
      `2026-06-0${(stamp % 9) + 1},Duplicate probe ${stamp},42.00,Utilities,Vater,`,
    ].join('\n')

    for (const round of [1, 2]) {
      await page.getByLabel('CSV contents').fill(csv)
      await page.getByRole('button', { name: 'Preview' }).click()
      const commit = page.getByRole('button', { name: /^Import \d+ row/ })
      await expect(commit).toBeVisible()

      if (round === 1) {
        await commit.click()
        await expect(page.getByText(/Imported 1 row\(s\)/)).toBeVisible()
      } else {
        // Second pass: nothing left to import.
        await expect(page.getByText(/1 already present/)).toBeVisible()
        await expect(commit).toBeDisabled()
      }
    }
  })
})
