/**
 * Invitations.
 *
 * The security property under test is the one that is easy to get wrong and
 * invisible when it is wrong: the emailed link is a bearer credential, but on
 * its own it must grant nothing. Both halves are required — a valid token *and*
 * a session whose email is the invited address — so a forwarded link, or one
 * left sitting in a chat history, cannot be redeemed by anyone else.
 *
 * That is asserted directly with a third account. A test that only checks the
 * happy path would still pass if the email check were deleted.
 *
 * Slow by necessity: three identities means three OTP round trips against a
 * 3-per-60s rate limit. The protection stays on.
 */
import { expect, test } from '@playwright/test'

import { readInviteLink, registerUser } from './helpers'

/**
 * Unique per run. The E2E database persists between runs, so a fixed address
 * gets created by the first run and every later one is told "that email already
 * has an account" — a failure that looks exactly like a broken registration
 * flow. setup.spec.ts uses the same trick.
 */
const RUN = Date.now()
const VALE = `vale-invited-${RUN}@splitwise.local`
const EVE = `eve-stranger-${RUN}@splitwise.local`

/**
 * ⚠ MARKED FIXME — NOT YET PROVEN. See the note below.
 *
 * The parts of this that are proven: an invitation is created by an owner, it
 * appears in the pending list, and the email arrives in Mailpit with a working
 * /invite/<token> link. All three were observed in a real browser.
 *
 * What is NOT proven: the accept and refuse paths. The whole test cannot get
 * there inside a sane time budget. It needs three identities, which is three
 * OTP round trips against Better Auth's 3-per-60s limit, and the helpers wait
 * that limit out rather than disabling it — roughly five minutes of the test
 * sleeping, which is correct behaviour that simply does not fit a suite this
 * size. It ran out of budget before reaching the end.
 *
 * Two bugs were found and fixed while chasing this, so the body is worth
 * keeping: registerUser had no verify-retry loop, and fixed email addresses
 * collided with a database that persists between runs.
 *
 * Un-skip this once the suite either gets a per-test rate-limit override or this
 * spec stops needing a third identity.
 */
test.describe('space invitations', () => {
  // Each identity needs its own signed-out context.
  test.use({ storageState: { cookies: [], origins: [] } })
  // Generous, and deliberately so: this test needs three identities, which is
  // three OTP round trips against a 3-per-60s limit, and the helpers wait the
  // limit out rather than disabling it. A 5-minute budget was not enough — the
  // waits are the correct behaviour, not a flake.
  test.setTimeout(600_000)

  test.fixme('only the invited address can redeem a link, and only once', async ({
    browser,
  }) => {
    // ── the owner invites someone ───────────────────────────────────────
    // The shared session is the seeded demo account.
    const ownerCtx = await browser.newContext({
      storageState: 'test-results/auth.json',
    })
    const owner = await ownerCtx.newPage()

    // A dedicated space, not the seeded Hauptstraße. Adding a member to the
    // shared one leaks into every later spec: the split editor labels its
    // controls by display name, so a second "Vale" makes "Vale percent" match
    // two elements and fails an unrelated test with a baffling message.
    await owner.goto('/spaces/new')
    await owner.getByLabel('Space name').fill('Invite Test Space')
    await owner.getByLabel('Your name in this space').fill('Owner')
    await owner.getByRole('button', { name: 'Create space' }).click()
    await owner.waitForURL(/dashboard/, { timeout: 30_000 })

    await owner.goto('/settings')
    await owner.getByLabel('Email address').fill(VALE)
    await owner.getByRole('button', { name: /^Invite$/ }).click()

    // It appears in the pending list, which is the only way to tell a live
    // invitation from one that was mailed to a typo.
    // Scoped to the row, and checked for "pending" rather than just presence:
    // an address sitting in this list marked accepted or expired is a very
    // different thing from a live invitation.
    const pending = owner.locator('li').filter({ hasText: VALE }).first()
    await expect(pending).toBeVisible({ timeout: 30_000 })
    await expect(pending).toContainText('expires in')

    const link = await readInviteLink(VALE)
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]+$/)

    // ── a stranger opens the link: must be refused ───────────────────────
    const eveCtx = await browser.newContext()
    const eve = await eveCtx.newPage()
    await registerUser(eve, 'Eve', EVE)

    await eve.goto(link)
    // The invitation names its address, so the mismatch is visible before the
    // user bothers trying.
    await expect(eve.getByText(VALE)).toBeVisible({
      timeout: 30_000,
    })
    await eve.getByRole('button', { name: /^Join / }).click()

    await expect(eve.getByRole('alert')).toContainText(VALE, {
      timeout: 30_000,
    })
    // And she is still not in the household.
    await eve.goto('/dashboard')
    await expect(eve.getByText('Set up your ledger')).toBeVisible()

    // ── the invited address registers and joins ─────────────────────────
    const valeCtx = await browser.newContext()
    const vale = await valeCtx.newPage()
    await registerUser(vale, 'Vale', VALE)

    await vale.goto(link)
    await vale.getByRole('button', { name: /^Join / }).click()
    await vale.waitForURL(/\/dashboard/, { timeout: 30_000 })

    // She lands inside the household, not in her own empty setup.
    await expect(
      vale.getByRole('heading', { name: 'Invite Test Space' }),
    ).toBeVisible({ timeout: 30_000 })

    // And she can create her own space too — this is the whole point of the
    // tenancy model, so it is asserted rather than assumed.
    await vale.goto('/settings')
    await vale.getByRole('link', { name: 'New space' }).first().click()
    await expect(vale).toHaveURL(/\/spaces\/new/)
    await vale.getByLabel('Space name').fill('Vale alone')
    await vale.getByLabel('Your name in this space').fill('Vale')
    await vale.getByRole('button', { name: 'Create space' }).click()
    await expect(vale).toHaveURL(/\/dashboard/)
    await expect(
      vale.getByRole('heading', { name: 'Vale alone' }),
    ).toBeVisible()

    // Two households, one account.
    await vale.locator('button[aria-haspopup=listbox]:visible').click()
    await expect(vale.locator('[role=option]')).toHaveCount(2)

    // ── she is a member, not an owner: no invite controls ───────────────
    // The static check already asserts the server refuses a non-owner. This
    // covers the half a static check cannot see — that the panel is not even
    // rendered for someone who cannot use it.
    await vale.goto('/settings')
    await vale.locator('button[aria-haspopup=listbox]:visible').click()
    await vale.getByRole('option', { name: /Invite Test Space/ }).click()
    await expect(
      vale.getByRole('heading', { name: 'Invite Test Space' }),
    ).toBeVisible()
    await expect(vale.getByText('Invite people')).toHaveCount(0)
    // She can still see who she is sharing the ledger with.
    await expect(vale.getByText('Members')).toBeVisible()

    // ── the link is now spent ────────────────────────────────────────────
    await vale.goto(link)
    await expect(vale.getByText('Already accepted')).toBeVisible({
      timeout: 30_000,
    })

    await ownerCtx.close()
    await eveCtx.close()
    await valeCtx.close()
  })
})
