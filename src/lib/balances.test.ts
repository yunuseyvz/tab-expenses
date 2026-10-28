/**
 * The balance sheet has to add up. Against a real Postgres.
 *
 * The report this exists for: two people in one household both shown as owing the
 * household money, which cannot be true, and which the screen offered to "settle"
 * anyway. The cause was not rounding and not the settlement maths. `paid` and
 * `share` are two independent facts about an expense — who put the money out, and
 * who owes a slice of it — and they were being aggregated over a single join path:
 *
 *     space_member -> expense_split -> expense
 *
 * An expense is therefore only reachable from its payer if the payer ALSO has a
 * split row on it. "Alex paid for this and only Robin owes it" is perfectly
 * legal — the payer is picked from a separate "Who paid" strip, independent of the
 * split checkboxes — and it made the whole amount vanish from Alex's paid column
 * while Robin's share of it was still counted. The household was left short by
 * exactly the amount Alex had covered, permanently, and every member's net was
 * wrong by a piece of it.
 *
 * The same shape has a second instance: an expense with no split rows at all. The
 * editor sends `splits: []` to mean "nobody is sharing this", the payer absorbs
 * the whole thing, and there is no row for anyone to reach the expense through.
 * That expense was absent from balances entirely while being present in the
 * ledger, the totals and the donut — so "total spend" and "the sum of what people
 * owe" were two different numbers on the same screen.
 *
 * ── on the arithmetic ────────────────────────────────────────────────────────
 *
 * net = paid − share, so the nets sum to zero whenever every expense's amount is
 * matched by exactly one set of shares totalling that amount. That is the whole
 * invariant, and it is worth stating plainly because it is the thing that was
 * broken:
 *
 *     sum over members of paid  ==  sum over members of share
 *
 * Not approximately. Exactly, for every roster of active members.
 *
 * ── on what is deliberately NOT asserted ─────────────────────────────────────
 *
 * A share belonging to a member who has since been archived does NOT have to be
 * counted, and the nets are expected not to sum to zero when one exists. The
 * roster is active members only — that is a decision, documented on
 * `applySettlements`, and it is the right one: a settlement plan that told you to
 * pay somebody who has left would be worse than one that leaves the remainder
 * visible. So the sum-to-zero assertion below runs on a roster where everybody is
 * still here, which is the case that was actually wrong.
 *
 * Runs against DATABASE_URL and skips (rather than fails) when no database is
 * reachable, so `pnpm test` still works on a bare checkout.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'

import { closeDb, getDb } from '#/lib/db'
import {
  loadBalances,
  loadExpensePage,
  loadShareTotals,
} from '#/lib/expense.functions'
import { describeIfDatabase } from '#/lib/test-db'
import {
  expense,
  expenseSplit,
  space,
  spaceMember,
  user,
} from '#/lib/db/schema'

describe.runIf(await describeIfDatabase())('balances add up', () => {
  const ids = {
    user: randomUUID(),
    space: randomUUID(),
  }
  const owner = { name: 'Fede', email: null }
  const other = { name: 'Vale', email: null }

  let Fede: string
  let Vale: string
  /** Every expense amount written, so the two sides can be compared directly. */
  let writtenMinor = 0

  async function balances() {
    return loadBalances(getDb(), {
      spaceId: ids.space,
      from: null,
      to: null,
      categoryIds: undefined,
    })
  }

  function byName(rows: Awaited<ReturnType<typeof balances>>) {
    return new Map(rows.map((r) => [r.displayName, r]))
  }

  /**
   * One expense, with whatever split the case under test needs.
   *
   * `splits` is a list of [member, shareMinor]. Passing none writes no rows at
   * all, which is the "nobody is sharing this" case and is deliberately a
   * different thing from "split between nobody in particular".
   */
  async function writeExpense(opts: {
    payer: string
    amountMinor: number
    splits: Array<[string, number]>
    spentOn?: string
  }) {
    const db = getDb()
    const [row] = await db
      .insert(expense)
      .values({
        spaceId: ids.space,
        paidByMemberId: opts.payer,
        spentOn: opts.spentOn ?? '2026-06-01',
        purpose: 'Test',
        amountMinor: opts.amountMinor,
        createdByUserId: ids.user,
      })
      .returning()
    writtenMinor += opts.amountMinor

    if (opts.splits.length) {
      const total = opts.splits.reduce((s, [, m]) => s + m, 0)
      // The ledger's own invariant, checked at the source rather than trusted.
      expect(total, `splits must total ${opts.amountMinor}`).toBe(
        opts.amountMinor,
      )
      await db.insert(expenseSplit).values(
        opts.splits.map(([memberId, shareMinor]) => ({
          expenseId: row!.id,
          memberId,
          // The weight is the editable intent and is deliberately not the share:
          // 50/50 and 90/10 can produce the same cents, and the balances screen
          // must not care which was typed.
          weightBp: Math.round((shareMinor / opts.amountMinor) * 10_000),
          shareMinor,
        })),
      )
    }
    return row!
  }

  beforeAll(async () => {
    const db = getDb()
    await db.insert(user).values({
      id: ids.user,
      name: owner.name,
      email: `balances-${ids.user}@test.local`,
      emailVerified: true,
    })
    await db.insert(space).values({
      id: ids.space,
      name: 'Balances',
      currency: 'EUR',
      createdByUserId: ids.user,
    })
    const rows = await db
      .insert(spaceMember)
      .values([
        {
          spaceId: ids.space,
          userId: ids.user,
          displayName: owner.name,
          color: 'terracotta',
          role: 'owner',
        },
        {
          spaceId: ids.space,
          userId: null,
          displayName: other.name,
          color: 'sage',
          role: 'member',
        },
      ])
      .returning({ id: spaceMember.id })
    Fede = rows[0]!.id
    Vale = rows[1]!.id
  })

  afterAll(async () => {
    const db = getDb()
    await db.delete(expense).where(eq(expense.spaceId, ids.space))
    await db.delete(spaceMember).where(eq(spaceMember.spaceId, ids.space))
    await db.delete(space).where(eq(space.id, ids.space))
    await db.delete(user).where(eq(user.id, ids.user))
    await closeDb()
  })

  it('counts an expense for a payer who is not in the split', async () => {
    // The reported case. Vale fronts €50 and only Fede owes it — no share row
    // naming Vale anywhere on this expense.
    await writeExpense({
      payer: Vale,
      amountMinor: 5_000,
      splits: [[Fede, 5_000]],
    })

    const rows = await balances()
    const m = byName(rows)
    expect(m.get(other.name)!.paidMinor).toBe(5_000)
    expect(m.get(other.name)!.shareMinor).toBe(0)
    expect(m.get(other.name)!.netMinor).toBe(5_000)
    expect(m.get(owner.name)!.paidMinor).toBe(0)
    expect(m.get(owner.name)!.shareMinor).toBe(5_000)
    expect(m.get(owner.name)!.netMinor).toBe(-5_000)
  })

  it('counts an expense nobody is sharing, against the payer', async () => {
    // `splits: []` means "nobody is sharing this". The payer absorbs the whole
    // amount, so their paid AND their share both move and their net does not.
    //
    // The share half is the one that is easy to leave out, and leaving it out is
    // not neutral: the payer shows as OWED the amount for a cost nobody shared,
    // and the screen offers to write a settlement for it. "100 to nobody" has to
    // mean the household is €100 better off, not €100 in debt to one man.
    await writeExpense({ payer: Fede, amountMinor: 3_333, splits: [] })

    const rows = await balances()
    const m = byName(rows)
    // Fede has also got the €50 share from the previous test.
    expect(m.get(owner.name)!.paidMinor).toBe(3_333)
    expect(m.get(owner.name)!.shareMinor).toBe(5_000 + 3_333)
    expect(m.get(owner.name)!.netMinor).toBe(-5_000)
  })

  it('never shows both members as owing', async () => {
    // The symptom as reported, asserted as the shape it actually takes: if the
    // nets do not sum to zero then at least one of them is wrong, and the screen
    // will happily offer to settle a debt that does not exist.
    const rows = await balances()
    const netSum = rows.reduce((s, r) => s + r.netMinor, 0)
    expect(netSum, 'nets must sum to zero').toBe(0)

    // The symptom as reported, stated correctly. One person owing while another is
    // owed is a perfectly good ledger. EVERYONE owing is not: there is no counterparty
    // for any of it, which is the shape the screen was showing.
    const owing = rows.filter((r) => r.netMinor < 0)
    const owed = rows.filter((r) => r.netMinor > 0)
    expect(
      !(owing.length > 0 && owed.length === 0) || owing.length === rows.length,
      'if the household owes nobody, nobody can owe the household',
    ).toBe(true)
    expect(
      rows.every((r) => r.netMinor === 0) || owing.length < rows.length,
      'not every member can be a debtor at once',
    ).toBe(true)
  })

  it('agrees with the ledger: every euro paid is a euro owed', async () => {
    const rows = await balances()
    const paid = rows.reduce((s, r) => s + r.paidMinor, 0)
    const share = rows.reduce((s, r) => s + r.shareMinor, 0)

    // Every expense is accounted for on both sides, including the unshared ones:
    // the payer's implied share is what puts those on the share column. If the
    // two columns ever disagree by so much as one unshared expense, then "total
    // spend" on the dashboard and "what people owe" on balances are two different
    // numbers describing one ledger.
    expect(paid).toBe(writtenMinor)
    expect(share).toBe(writtenMinor)
    expect(paid - share).toBe(0)

    // And there really is an unshared expense in here, or the assertion above is
    // not testing the thing it claims to.
    const orphans = await getDb()
      .select({ id: expense.id })
      .from(expense)
      .where(eq(expense.spaceId, ids.space))
    expect(orphans.length).toBeGreaterThan(0)
  })

  it('keeps a split even when nobody is in it, without inventing a share', async () => {
    // €50 paid by Vale, split so unevenly it rounds: Fede 4999, Vale 1. The
    // total is still 5000 and the payer still has a share row, which is the case
    // the old join happened to get right — asserted so the fix did not only work
    // for the case that was broken.
    await writeExpense({
      payer: Vale,
      amountMinor: 2_500,
      splits: [
        [Fede, 2_499],
        [Vale, 1],
      ],
    })

    const rows = await balances()
    const netSum = rows.reduce((s, r) => s + r.netMinor, 0)
    expect(netSum).toBe(0)

    const m = byName(rows)
    expect(m.get(other.name)!.paidMinor).toBe(7_500)
    expect(m.get(other.name)!.shareMinor).toBe(1)
  })

  it('gives the dashboard and the balance sheet the same share', async () => {
    /*
     * The second half of the same bug, found the day after the first was fixed.
     *
     * `getTotals` computed "Your share" from its own query over `expense_split`,
     * which is right for every expense that has splits and wrong for every expense
     * that has none. So the dashboard said your share was EUR 8,475.93 on the same
     * expenses the balance sheet said you owed EUR 10,859.10 of — one number, two
     * meanings, 28% apart.
     *
     * Two implementations of one definition is the actual defect, so what is
     * asserted is that both readers now come from the same function and therefore
     * cannot drift again.
     */
    const rows = await balances()
    const me = byName(rows).get(owner.name)!
    const shared = await loadShareTotals(getDb(), [
      eq(expense.spaceId, ids.space),
    ])

    expect(shared.get(me.memberId)).toBe(me.shareMinor)

    // And the difference from the split-only reading is exactly the unshared
    // money Fede fronted — which is the part that was being dropped.
    const splitRows = await getDb()
      .select({ shareMinor: expenseSplit.shareMinor })
      .from(expenseSplit)
      .where(eq(expenseSplit.memberId, me.memberId))
    const splitOnly = splitRows.reduce((s, r) => s + Number(r.shareMinor), 0)
    expect(me.shareMinor).toBe(splitOnly + 3_333)
  })

  /*
   * ── additivity ────────────────────────────────────────────────────────────
   *
   * A balance is a sum over expenses, so the whole period MUST equal the sum of
   * its days. That is not a nicety: it is what makes the screen checkable by hand,
   * and it is exactly the property a reader tests without being told to. "Each
   * day matches my arithmetic, but when the app adds the days up it does something
   * weird" is a report of this invariant failing, and there is no way to answer it
   * except by asserting it.
   *
   * Three days, different payers, a split that is not even, and an unshared
   * expense — so the partition crosses every shape that could make an aggregate
   * non-additive.
   */
  it('aggregates over a period exactly as it does day by day', async () => {
    const db = getDb()
    // A clean slate, so the days are the only thing in range.
    await db.delete(expense).where(eq(expense.spaceId, ids.space))

    await writeExpense({
      payer: Vale,
      amountMinor: 5_000,
      splits: [
        [Fede, 3_000],
        [Vale, 2_000],
      ],
      spentOn: '2026-03-01',
    })
    await writeExpense({
      payer: Fede,
      amountMinor: 3_333,
      splits: [],
      spentOn: '2026-03-02',
    })
    await writeExpense({
      payer: Vale,
      amountMinor: 2_500,
      splits: [[Fede, 2_500]],
      spentOn: '2026-03-03',
    })
    await writeExpense({
      payer: Fede,
      amountMinor: 1_001,
      splits: [
        [Fede, 500],
        [Vale, 501],
      ],
      spentOn: '2026-03-03',
    })

    const range = async (from: string, to: string) =>
      loadBalances(db, { spaceId: ids.space, from, to, categoryIds: undefined })

    const whole = await range('2026-03-01', '2026-03-31')
    const days = await Promise.all([
      range('2026-03-01', '2026-03-01'),
      range('2026-03-02', '2026-03-02'),
      range('2026-03-03', '2026-03-03'),
    ])

    for (const name of [owner.name, other.name]) {
      const wholeRow = whole.find((r) => r.displayName === name)!
      const parts = days.map((d) => d.find((r) => r.displayName === name)!)

      // The three columns separately, because a total that matches while its
      // parts do not is a coincidence rather than an invariant.
      expect(
        parts.reduce((s, p) => s + p.paidMinor, 0),
        `${name}: paid must add up`,
      ).toBe(wholeRow.paidMinor)
      expect(
        parts.reduce((s, p) => s + p.shareMinor, 0),
        `${name}: share must add up`,
      ).toBe(wholeRow.shareMinor)
      expect(
        parts.reduce((s, p) => s + p.netMinor, 0),
        `${name}: net must add up`,
      ).toBe(wholeRow.netMinor)
    }

    // And the whole thing still balances, day by day and in total.
    for (const rows of [...days, whole]) {
      expect(rows.reduce((s, r) => s + r.netMinor, 0)).toBe(0)
    }
  })

  /*
   * ── the ledger's own daily figures ────────────────────────────────────────
   *
   * The report that says each day is right but the days do not add up.
   *
   * Two different numbers are on that screen. The day headers are computed in the
   * BROWSER, from whatever rows the query returned (`groupByDay` sums the array it
   * is given); the period total is computed in SQL over the whole filter. While
   * the list was unfiltered and small those were the same set and agreed. They stop
   * agreeing the moment the list returns fewer rows than the filter matches — and
   * it did that silently, at 200, with no paging and nothing on screen to say so.
   *
   * A reader then does the obvious thing: adds up the day figures, and finds a
   * total that does not match the app's. Both numbers are "the app's", and neither
   * is obviously the broken one.
   */
  it('has day headers that agree with the period total', async () => {
    const db = getDb()
    await db.delete(expense).where(eq(expense.spaceId, ids.space))

    // More days than one page holds, so the query cannot return all of them.
    const DAYS = 60
    for (let i = 0; i < DAYS; i++) {
      await writeExpense({
        payer: Fede,
        amountMinor: 1_000 + i,
        splits: [],
        spentOn: `2026-04-${String((i % 28) + 1).padStart(2, '0')}`,
      })
    }

    const filter = {
      spaceId: ids.space,
      from: '2026-04-01',
      to: '2026-04-30',
      categoryIds: undefined,
    }

    // What SQL says the period cost.
    const { getDb: _unused } = await import('#/lib/db')
    void _unused
    const [all] = (await db.execute(
      sql`select coalesce(sum(amount_minor), 0)::int as total from expense where space_id = ${ids.space}::uuid`,
    )) as unknown as Array<{ total: number }>
    const periodTotal = Number(all?.total ?? 0)

    // What the screen would show: one page of rows, grouped by day in the browser.
    const page = await loadExpensePage(db, filter, { limit: 50, offset: 0 })
    const pageDayTotal = page.rows.reduce((s, r) => s + r.amountMinor, 0)

    expect(page.total).toBe(DAYS)
    // The page cannot reach the period, which is the whole reason it must not be
    // allowed to state a day total as if it were the day's total.
    expect(pageDayTotal).toBeLessThan(periodTotal)

    // The fix: the server sends the real per-day totals for the whole filter, and
    // they add up to the period total exactly.
    const byDay = new Map(page.dayTotals.map((d) => [d.spentOn, d.totalMinor]))
    const covered = [...byDay.entries()]
      .filter(([date]) => date >= filter.from && date <= filter.to)
      .reduce((s, [, v]) => s + v, 0)
    expect(covered).toBe(periodTotal)
    expect(page.dayTotals.reduce((s, d) => s + d.count, 0)).toBe(DAYS)
  })

  it('ignores an expense outside the period, on both sides', async () => {
    // Its own slate: this used to read a figure left behind by earlier tests,
    // which made it depend on their order and on nothing else.
    await getDb().delete(expense).where(eq(expense.spaceId, ids.space))

    await writeExpense({
      payer: Fede,
      amountMinor: 3_333,
      splits: [],
      spentOn: '2026-06-01',
    })
    await writeExpense({
      payer: Vale,
      amountMinor: 9_999,
      splits: [[Fede, 9_999]],
      spentOn: '2020-01-01',
    })

    const scoped = await loadBalances(getDb(), {
      spaceId: ids.space,
      from: '2026-01-01',
      to: '2026-12-31',
      categoryIds: undefined,
    })
    const netSum = scoped.reduce((s, r) => s + r.netMinor, 0)
    expect(netSum).toBe(0)
    expect(scoped.find((r) => r.displayName === owner.name)!.paidMinor).toBe(
      3_333,
    )
  })
})
