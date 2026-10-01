/**
 * Seed a demo space with a household's worth of history.
 *
 * Idempotent: re-running replaces the seeded rows for the demo user rather
 * than duplicating them. Safe to run against a dev database.
 *
 *   pnpm db:seed
 */
import { eq } from 'drizzle-orm'
import postgres from 'postgres'

import { allocate } from '../src/lib/money'
import { toISODate } from '../src/lib/period'
import { loadEnv } from './load-env'

// drizzle-kit loads .env on its own; this script has to do it for itself.
loadEnv()

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required. Copy .env.example to .env first.')
  process.exit(1)
}
const dbUrl: string = DATABASE_URL

const DEMO_EMAIL = 'demo@splitwise.local'
const DEMO_USER_ID = 'seed-demo-user'

async function main() {
  const sql = postgres(dbUrl, { max: 1 })

  try {
    // Drizzle is imported dynamically so `tsx` can load the TS schema.
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const schema = await import('../src/lib/db/schema')
    const db = drizzle(sql, { schema, casing: 'snake_case' })
    const { space, spaceMember, category, expense, expenseSplit } = schema

    // ── user ────────────────────────────────────────────────────────────
    // Upsert on EMAIL, not on a fixed id. Signing in through the app creates
    // this user with a Better Auth-generated id, so a seed that assumed its own
    // id collides on user_email_unique the moment anyone has used the app once
    // — and the seed is documented as re-runnable. Everything below therefore
    // references whatever id is actually in the database.
    const [demoUser] = await sql<Array<{ id: string }>>`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${DEMO_USER_ID}, 'Vale', ${DEMO_EMAIL}, true, now(), now())
      on conflict (email) do update
        set name = excluded.name,
            email_verified = true,
            updated_at = now()
      returning id
    `
    const demoUserId = demoUser?.id
    if (!demoUserId) throw new Error('failed to upsert the demo user')

    // ── space + members ─────────────────────────────────────────────────
    // Tear down first so the script is re-runnable.
    const existing = await db
      .select({ id: space.id })
      .from(space)
      .where(eq(space.createdByUserId, demoUserId))

    for (const s of existing) {
      await db.delete(space).where(eq(space.id, s.id))
    }

    const [wg] = await db
      .insert(space)
      .values({
        name: 'Hauptstraße',
        currency: 'EUR',
        createdByUserId: demoUserId,
      })
      .returning()
    if (!wg) throw new Error('failed to insert space')

    const [me] = await db
      .insert(spaceMember)
      .values({
        spaceId: wg.id,
        userId: demoUserId,
        displayName: 'Vale',
        color: 'terracotta',
        defaultWeightBp: 6000,
        role: 'owner',
      })
      .returning()
    const [vater] = await db
      .insert(spaceMember)
      .values({
        spaceId: wg.id,
        userId: null, // virtual member — carries a share, never registers
        displayName: 'Vater',
        color: 'sage',
        defaultWeightBp: 4000,
        role: 'member',
      })
      .returning()
    const [mila] = await db
      .insert(spaceMember)
      .values({
        spaceId: wg.id,
        userId: null,
        displayName: 'Mila',
        color: 'indigo',
        defaultWeightBp: 0,
        role: 'member',
      })
      .returning()

    if (!me || !vater || !mila) throw new Error('failed to insert members')

    // ── categories ──────────────────────────────────────────────────────
    const shared = [
      { name: 'Home', color: 'terracotta', icon: 'home', sortOrder: 0 },
      { name: 'Groceries', color: 'sage', icon: 'utensils', sortOrder: 1 },
      { name: 'Utilities', color: 'indigo', icon: 'zap', sortOrder: 2 },
      { name: 'Health', color: 'oxblood', icon: 'heart-pulse', sortOrder: 3 },
    ]
    const sharedRows = await db
      .insert(category)
      .values(
        shared.map((c) => ({ ...c, spaceId: wg.id, scope: 'shared' as const })),
      )
      .returning()
    const byName = new Map(sharedRows.map((c) => [c.name, c]))

    // A personal category: excluded from shared views, still counted in Mila's
    // own balance.
    await db.insert(category).values({
      spaceId: wg.id,
      name: 'Mila — hobby budget',
      color: 'plum',
      icon: 'palette',
      scope: 'personal',
      ownerMemberId: mila.id,
      sortOrder: 4,
    })

    // ── expenses ────────────────────────────────────────────────────────
    // Deliberately includes the plan's 60/40 WG case, an odd-cent split, and
    // a period with nothing in it, so the filters and the balance maths have
    // something real to work against.
    const today = new Date()
    const iso = (daysAgo: number) => {
      const d = new Date(today)
      d.setDate(d.getDate() - daysAgo)
      return toISODate(d)
    }

    const plan: Array<{
      daysAgo: number
      purpose: string
      minor: number
      category: string | null
      payer: typeof me
      weights: Array<[typeof me, number]>
    }> = [
      // The 60/40 case from the plan: €100, 60% mine, 40% Vater's.
      {
        daysAgo: 1,
        purpose: 'Weekly groceries',
        minor: 10000,
        category: 'Groceries',
        payer: me,
        weights: [
          [me, 6000],
          [vater, 4000],
        ],
      },
      {
        daysAgo: 2,
        purpose: 'Electricity',
        minor: 8450,
        category: 'Utilities',
        payer: vater,
        weights: [
          [me, 5000],
          [vater, 5000],
        ],
      },
      {
        daysAgo: 3,
        purpose: 'Pharmacy',
        minor: 2370,
        category: 'Health',
        payer: me,
        weights: [
          [me, 6000],
          [vater, 4000],
        ],
      },
      // Odd cent: 5c at 50/30/20 → 3/1/1. The payer absorbs the odd cent.
      {
        daysAgo: 4,
        purpose: 'Bread',
        minor: 5,
        category: 'Groceries',
        payer: vater,
        weights: [
          [me, 5000],
          [vater, 3000],
          [mila, 2000],
        ],
      },
      {
        daysAgo: 5,
        purpose: 'Rent transfer',
        minor: 145000,
        category: 'Home',
        payer: me,
        weights: [
          [me, 5000],
          [vater, 5000],
        ],
      },
      {
        daysAgo: 6,
        purpose: 'Train tickets',
        minor: 4900,
        category: null,
        payer: me,
        weights: [
          [me, 6000],
          [vater, 4000],
        ],
      },
      // Last month, so the period selector has something to switch to.
      {
        daysAgo: 40,
        purpose: 'Previous rent',
        minor: 145000,
        category: 'Home',
        payer: me,
        weights: [
          [me, 5000],
          [vater, 5000],
        ],
      },
      {
        daysAgo: 45,
        purpose: 'Internet',
        minor: 3999,
        category: 'Utilities',
        payer: vater,
        weights: [
          [me, 5000],
          [vater, 5000],
        ],
      },
      // Personal category: only in Mila's own totals.
      {
        daysAgo: 7,
        purpose: 'Watercolours',
        minor: 3200,
        category: 'Mila — hobby budget',
        payer: mila,
        weights: [[mila, 10000]],
      },
    ]

    for (const e of plan) {
      const weightTotal = e.weights.reduce((s, [, w]) => s + w, 0)
      if (weightTotal !== 10_000) {
        throw new Error(`${e.purpose}: weights sum to ${weightTotal}`)
      }
      const shares = allocate(
        e.minor,
        e.weights.map(([, w]) => w),
      )

      const [row] = await db
        .insert(expense)
        .values({
          spaceId: wg.id,
          categoryId: e.category ? (byName.get(e.category)?.id ?? null) : null,
          paidByMemberId: e.payer.id,
          spentOn: iso(e.daysAgo),
          purpose: e.purpose,
          amountMinor: e.minor,
          createdByUserId: demoUserId,
        })
        .returning()
      if (!row) throw new Error(`failed to insert ${e.purpose}`)

      await db.insert(expenseSplit).values(
        e.weights.map(([m, w], i) => ({
          expenseId: row.id,
          memberId: m.id,
          weightBp: w,
          shareMinor: shares[i]!,
        })),
      )
    }

    // ── verify the split invariant actually held ────────────────────────
    // Only for expenses that HAVE splits. An expense with none is legitimate —
    // the payer takes the whole amount, which is how the balances query reads
    // it — and it has no rows to sum, so comparing 0 against the amount flags
    // every single unsplit expense as broken. It only surfaced once splitting
    // could actually be turned off, which is exactly the bug fixed alongside it.
    const [mismatch] = await sql<Array<{ bad: number }>>`
      select count(*)::int as bad
      from expense e
      join lateral (
        select coalesce(sum(s.share_minor), 0)::int as total
        from expense_split s where s.expense_id = e.id
      ) t on true
      where t.total <> e.amount_minor
        and exists (select 1 from expense_split s2 where s2.expense_id = e.id)
    `
    const badCount = Number(mismatch?.bad ?? 0)
    if (badCount !== 0) {
      throw new Error(
        `${badCount} expense(s) violate sum(share_minor) = amount_minor`,
      )
    }

    console.log(`Seeded space "${wg.name}" (${wg.id})`)
    console.log(`  members:    Vale (you), Vater, Mila`)
    console.log(`  categories: ${shared.length} shared + 1 personal`)
    console.log(`  expenses:   ${plan.length}, split invariant verified`)
    console.log(`\nSign in as ${DEMO_EMAIL} to see it.`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
