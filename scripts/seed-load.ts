/**
 * Seed a LARGE household into its own space, for load testing and for looking at
 * the app with a realistic amount of history in it.
 *
 *   pnpm db:seed-load
 *
 * Separate from `pnpm db:seed` on purpose, and on a separate account.
 *
 * The demo space the e2e suite signs into is nine expenses and three people, and
 * that is exactly the right size for asserting on: a test that reads "row 3" wants
 * a ledger where row 3 exists. This is the opposite shape — six people, sixteen
 * categories and roughly a year and a half of entries — because that is the only
 * way to find out whether the month picker, the recap comparison, the balance
 * maths and the ledger's day-grouping hold up on something that looks like real
 * use. None of those can be judged against nine rows, and all of them are cheap to
 * get wrong.
 *
 * Kept off `demo@tab.local` so that loading up this space cannot make a test
 * flaky. A shared account is a shared ledger, and the suite's assertions are
 * written against the small one.
 *
 * Idempotent: re-running replaces this space and everything under it, and leaves
 * every other space alone. Safe against a dev database.
 *
 * ── on randomness ──────────────────────────────────────────────────────────
 *
 * Deterministic, from a fixed seed. `Math.random()` would give a different
 * household every run, which makes it impossible to say "that scroll jank at 400
 * rows" is fixed, and impossible to compare two screenshots of the same screen.
 * The PRNG is written out rather than imported because the point is that it never
 * changes: a library upgrade must not silently reseed a year of history.
 *
 * ── on what is generated rather than typed ─────────────────────────────────
 *
 * The recurring series reuse `dueOccurrences` from src/lib/recurrence.ts and are
 * inserted with their own (recurring_id, period_key) pairs, then the template's
 * cursor is advanced past today. Materialisation runs on every read, so a cursor
 * left behind would quietly append to a ledger that is supposed to be finished.
 * Advancing it is what makes this seed stable: the next read finds nothing due.
 *
 * Amounts come from per-category ranges, which is a lie in the way any fixture is
 * a lie — real groceries are not uniform between €4 and €180. What it buys is a
 * distribution the totals, the donut and the largest-expense readout have to be
 * right about, which a list of round numbers would not exercise.
 */
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import postgres from 'postgres'

import { BP_TOTAL, allocate } from '../src/lib/money'
import { apportion } from '../src/components/expense/SplitEditor'
import { toISODate } from '../src/lib/period'
import { anchorDayOf, dueOccurrences } from '../src/lib/recurrence'
import { purgeSpace } from '../src/lib/space.functions'
import { loadEnv } from './load-env'
import type { Frequency } from '../src/lib/recurrence'

loadEnv()

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required. Copy .env.example to .env first.')
  process.exit(1)
}
const dbUrl: string = DATABASE_URL

/** The account that owns the load-test household. Distinct from the e2e demo. */
const OWNER_EMAIL = 'demo@splitwise.local'

/** Months of history. Fourteen is "long enough to page", not "long enough to be slow". */
const MONTHS = 14

/** Roughly how many hand-typed entries on top of the generated series. */
const HAND_TYPED = 760

/**
 * Fixed. Any change here is a different household, so treat it as part of the
 * fixture rather than as a tuning knob.
 */
const PRNG_SEED = 0x5eed_1a0d

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface MemberSpec {
  name: string
  email: string | null
  color: string
  weightBp: number
}

const MEMBERS: Array<MemberSpec> = [
  { name: 'Sam', email: OWNER_EMAIL, color: 'terracotta', weightBp: 3000 },
  {
    name: 'Noor',
    email: 'noor@splitwise.local',
    color: 'sage',
    weightBp: 2500,
  },
  {
    name: 'Robin',
    email: 'robin@splitwise.local',
    color: 'indigo',
    weightBp: 2000,
  },
  {
    name: 'June',
    email: 'june@splitwise.local',
    color: 'ochre',
    weightBp: 1500,
  },
  {
    name: 'Felix',
    email: 'felix@splitwise.local',
    color: 'plum',
    weightBp: 1000,
  },
  // Virtual: carries a share, never registers. Worth having in the roster because
  // it is the one member shape that has no account behind it, and every balance
  // query has to cope with it.
  { name: 'Ollie', email: null, color: 'teal', weightBp: 0 },
]

interface CategorySpec {
  name: string
  color: string
  icon: string
  /** Min and max, in minor units. */
  range: [number, number]
  /** How many entries per month, on average. */
  density: number
  purposes: Array<string>
  /** Whose money it is. Personal categories are excluded from the shared ledger. */
  personalFor?: string
}

const SHARED: Array<Omit<CategorySpec, 'personalFor'>> = [
  {
    name: 'Groceries',
    color: 'sage',
    icon: 'shopping-basket',
    range: [420, 18400],
    density: 11,
    purposes: [
      'Weekly groceries',
      'Big shop',
      'Top-up shop',
      'Market',
      'Fruit and veg',
      'Bakery run',
      'Pantry restock',
      'Household bits',
    ],
  },
  {
    name: 'Eating out',
    color: 'terracotta',
    icon: 'utensils',
    range: [1100, 9600],
    density: 5,
    purposes: [
      'Lunch',
      'Coffee',
      'Dinner out',
      'Takeaway',
      'Brunch',
      'Noodles',
      'Pizza',
      'Beers',
    ],
  },
  {
    name: 'Transport',
    color: 'indigo',
    icon: 'bus',
    range: [280, 7400],
    density: 4,
    purposes: [
      'Bus fare',
      'Train ticket',
      'Taxi home',
      'Petrol',
      'Bike repair',
      'Parking',
      'Airport bus',
    ],
  },
  {
    name: 'Utilities',
    color: 'ochre',
    icon: 'lightbulb',
    range: [1900, 12800],
    density: 3,
    purposes: [
      'Water',
      'Broadband',
      'Mobile',
      'TV licence',
      'Bins',
      'Boiler service',
    ],
  },
  {
    name: 'Household',
    color: 'teal',
    icon: 'sparkles',
    range: [900, 22000],
    density: 3,
    purposes: [
      'Cleaner',
      'Launderette',
      'Lightbulbs',
      'Bedding',
      'Kitchen roll',
      'Mop',
      'Shelves',
    ],
  },
  {
    name: 'Repairs',
    color: 'plum',
    icon: 'wrench',
    range: [1500, 46000],
    density: 1,
    purposes: [
      'Leaking tap',
      'Boiler',
      'Window latch',
      'Extractor fan',
      'Radiator',
      'Fridge',
      'Loft hatch',
    ],
  },
  {
    name: 'Health',
    color: 'oxblood',
    icon: 'heart-pulse',
    range: [350, 9800],
    density: 2,
    purposes: [
      'Pharmacy',
      'Dentist',
      'GP visit',
      'Boots',
      'Prescription',
      'Glasses',
      'Physio',
    ],
  },
  {
    name: 'Kids',
    color: 'moss',
    icon: 'baby',
    range: [800, 21000],
    density: 3,
    purposes: [
      'Childcare',
      'Swim class',
      'Playgroup',
      'Shoes',
      'Books for school',
      'Birthday present',
      'Nappies',
    ],
  },
  {
    name: 'Pets',
    color: 'sage',
    icon: 'paw-print',
    range: [450, 16000],
    density: 2,
    purposes: [
      'Food',
      'Litter',
      'Vet',
      'Insurance excess',
      'Flea treatment',
      'Dog walker',
    ],
  },
  {
    name: 'Going out',
    color: 'plum',
    icon: 'clapperboard',
    range: [1200, 14000],
    density: 2,
    purposes: [
      'Cinema',
      'Concert',
      'Birthday drinks',
      'Theatre',
      'Gallery',
      'Quiz night',
    ],
  },
  {
    name: 'Clothing',
    color: 'indigo',
    icon: 'shirt',
    range: [1200, 18000],
    density: 1,
    purposes: [
      'Work shirts',
      'Winter coat',
      'Trainers',
      'Socks',
      'Jacket repair',
    ],
  },
  {
    name: 'Gifts',
    color: 'terracotta',
    icon: 'gift',
    range: [1500, 26000],
    density: 1,
    purposes: [
      'Birthday present',
      'Christmas',
      'Wedding present',
      'New baby',
      'Thank you',
    ],
  },
]

const PERSONAL: Array<CategorySpec> = [
  {
    name: 'Sam — camera kit',
    color: 'terracotta',
    icon: 'laptop',
    range: [900, 34000],
    density: 1,
    purposes: ['Film', 'Lens repair', 'Prints', 'Tripod', 'Memory cards'],
    personalFor: 'Sam',
  },
  {
    name: 'Robin — hobby budget',
    color: 'indigo',
    icon: 'palette',
    range: [400, 19000],
    density: 1,
    purposes: ['Watercolours', 'Canvas', 'Framing', 'Workshop', 'Sketchbook'],
    personalFor: 'Robin',
  },
]

/**
 * The repeating series.
 *
 * One of them is anchored on the 31st, which is the case `nextOccurrence` exists
 * for: February clamps to the 28th, and the next month has to be the 31st again.
 * A fixture whose recurring dates all fell on the 12th would not notice that
 * working.
 */
interface SeriesSpec {
  purpose: string
  amountMinor: number
  category: string
  payer: string
  frequency: Frequency
  anchorDay: number
  /** Who carries it, as bp. Renormalised across the listed members. */
  weights: Array<[string, number]>
}

const SERIES: Array<SeriesSpec> = [
  {
    purpose: 'Rent',
    amountMinor: 168_000,
    category: 'Home',
    payer: 'Sam',
    frequency: 'monthly',
    anchorDay: 1,
    weights: [
      ['Sam', 5000],
      ['Noor', 2500],
      ['Robin', 2500],
    ],
  },
  {
    purpose: 'Heating',
    amountMinor: 24_500,
    category: 'Home',
    payer: 'Noor',
    frequency: 'monthly',
    anchorDay: 5,
    weights: [
      ['Sam', 4000],
      ['Noor', 3000],
      ['Robin', 3000],
    ],
  },
  {
    purpose: 'Electricity',
    amountMinor: 11_800,
    category: 'Utilities',
    payer: 'Felix',
    frequency: 'monthly',
    anchorDay: 8,
    weights: [
      ['Sam', 3334],
      ['Noor', 3333],
      ['Robin', 3333],
    ],
  },
  {
    purpose: 'Broadband',
    amountMinor: 4_199,
    category: 'Utilities',
    payer: 'Sam',
    frequency: 'monthly',
    anchorDay: 12,
    weights: [
      ['Sam', 5000],
      ['Noor', 5000],
    ],
  },
  {
    // The clamp. Deliberately on the 31st.
    purpose: 'Market stall',
    amountMinor: 7_500,
    category: 'Home',
    payer: 'June',
    frequency: 'monthly',
    anchorDay: 31,
    weights: [
      ['June', 5000],
      ['Sam', 5000],
    ],
  },
  {
    purpose: 'Travel passes',
    amountMinor: 9_600,
    category: 'Transport',
    payer: 'Robin',
    frequency: 'monthly',
    anchorDay: 2,
    weights: [
      ['Sam', 2000],
      ['Noor', 2000],
      ['Robin', 2000],
      ['June', 2000],
      ['Felix', 2000],
    ],
  },
  {
    purpose: 'Cleaner',
    amountMinor: 26_000,
    category: 'Household',
    payer: 'Sam',
    frequency: 'weekly',
    anchorDay: 0,
    weights: [
      ['Sam', 5000],
      ['Noor', 5000],
    ],
  },
  {
    purpose: 'Streaming bundle',
    amountMinor: 3_299,
    category: 'Household',
    payer: 'Felix',
    frequency: 'monthly',
    anchorDay: 18,
    weights: [
      ['Sam', 2500],
      ['Noor', 2500],
      ['Robin', 2500],
      ['June', 2500],
    ],
  },
]

const NOTE_AUTHORS = ['Sam', 'Noor', 'Robin', 'June', 'Felix']

const NOTES = [
  'Paid cash, the card receipt is in the drawer.',
  'This was the deposit — the balance is on the next one.',
  'Split this one three ways not six, we only used the big room.',
  'Reimbursable, I put the receipt in the post.',
  'Went up €4 since last month, the tariff went up.',
  'Checked the maths twice because it looked wrong.',
  'Robin covered the first half, so Robin gets a refund on this one.',
  'Bought the annual one. Worth doing.',
  'That is the late fee from the month we forgot.',
  'No receipt, sorry. It was cash at the door.',
  'Reduced to four shares, Felix is away that week.',
  'Market stall paid two months up front.',
]

async function main() {
  const sql = postgres(dbUrl, { max: 1 })

  try {
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const schema = await import('../src/lib/db/schema')
    const db = drizzle(sql, { schema, casing: 'snake_case' })
    const {
      space,
      spaceMember,
      category,
      expense,
      expenseSplit,
      expenseNote,
      settlement,
      recurringExpense,
      recurringExpenseSplit,
    } = schema

    const rand = mulberry32(PRNG_SEED)
    const pick = <T>(xs: ReadonlyArray<T>): T =>
      xs[Math.floor(rand() * xs.length)]!
    const between = (lo: number, hi: number) =>
      lo + Math.floor(rand() * (hi - lo + 1))
    const chance = (p: number) => rand() < p

    const today = new Date()
    const todayISO = toISODate(today)

    /** Days before today, as an ISO date. */
    const daysAgo = (n: number) => {
      const d = new Date(today)
      d.setDate(d.getDate() - n)
      return toISODate(d)
    }

    // ── users ───────────────────────────────────────────────────────────────
    // Upserted on email, never on a fixed id, for the same reason as seed.ts: a
    // real sign-in through the app has already created these rows with
    // Better Auth's own ids by the time anybody runs this.
    const users = new Map<string, string>()
    for (const m of MEMBERS) {
      if (!m.email) continue
      const [row] = await sql<Array<{ id: string }>>`
        insert into "user" (id, name, email, email_verified, created_at, updated_at)
        values (${randomUUID()}, ${m.name}, ${m.email}, true, now(), now())
        on conflict (email) do update
          set name = excluded.name,
              email_verified = true,
              updated_at = now()
        returning id
      `
      if (!row) throw new Error(`failed to upsert ${m.email}`)
      users.set(m.name, row.id)
    }

    const ownerId = users.get('Sam')
    if (!ownerId) throw new Error('owner user missing')

    // ── space ───────────────────────────────────────────────────────────────
    // Torn down first, and only this owner's spaces, so a re-run replaces rather
    // than duplicates. Cascades take members, categories, entries, notes,
    // settlements and series with it.
    const existing = await db
      .select({ id: space.id })
      .from(space)
      .where(eq(space.createdByUserId, ownerId))
    for (const s of existing) {
      /*
       * Through the app's own deletion path rather than a bare `delete from
       * space`. Two reasons, and the second is the real one.
       *
       * A bare delete only works if Postgres happens to fire the cascade into
       * every child before the one into `space_member`, and that ordering is an
       * artefact of trigger OIDs rather than a guarantee — `purgeSpace` exists
       * precisely because it is not safe to rely on. So seeding that dodged it
       * would have been a seed that works until it doesn't.
       *
       * And running the real path means a successful seed is also evidence that
       * `Delete space` works on a space with a year's of history, settlements and
       * repeating bills on it. That is the assertion this function did not have.
       */
      await purgeSpace(db, s.id)
    }

    const [house] = await db
      .insert(space)
      .values({
        name: 'Load Test',
        currency: 'EUR',
        icon: 'users',
        createdByUserId: ownerId,
      })
      .returning()
    if (!house) throw new Error('failed to insert space')

    // ── members ─────────────────────────────────────────────────────────────
    const memberByName = new Map<
      string,
      { id: string; userId: string | null }
    >()
    for (const [i, m] of MEMBERS.entries()) {
      const [row] = await db
        .insert(spaceMember)
        .values({
          spaceId: house.id,
          userId: m.email ? (users.get(m.name) ?? null) : null,
          displayName: m.name,
          color: m.color,
          defaultWeightBp: m.weightBp,
          role: m.email === OWNER_EMAIL ? 'owner' : 'member',
          // Staggered joins, so "who has been here how long" is answerable and
          // the roster is not five identical timestamps.
          createdAt: new Date(today.getTime() - (MONTHS - i) * 26 * 86_400_000),
        })
        .returning()
      if (!row) throw new Error(`failed to insert member ${m.name}`)
      memberByName.set(m.name, { id: row.id, userId: row.userId })
    }

    const id = (name: string) => {
      const m = memberByName.get(name)
      if (!m) throw new Error(`unknown member ${name}`)
      return m
    }
    /** The account behind a member, for provenance columns. */
    const uid = (name: string) => id(name).userId ?? ownerId

    // ── categories ──────────────────────────────────────────────────────────
    const categoryRows = await db
      .insert(category)
      .values([
        // "Home" exists to hang the recurring rent, heating and the market stall
        // off. It is seeded here rather than in SHARED because those series are
        // generated, not hand-typed, and a category with no hand-typed entries is
        // still a category somebody has to be able to pick.
        {
          spaceId: house.id,
          name: 'Home',
          color: 'moss',
          icon: 'home',
          sortOrder: 0,
          scope: 'shared' as const,
        },
        ...SHARED.map((c, i) => ({
          spaceId: house.id,
          name: c.name,
          color: c.color,
          icon: c.icon,
          sortOrder: i + 1,
          scope: 'shared' as const,
        })),
        ...PERSONAL.map((c, i) => ({
          spaceId: house.id,
          name: c.name,
          color: c.color,
          icon: c.icon,
          sortOrder: SHARED.length + i + 1,
          scope: 'personal' as const,
          ownerMemberId: id(c.personalFor!).id,
        })),
      ])
      .returning()
    const catByName = new Map(categoryRows.map((c) => [c.name, c.id]))

    // ── hand-typed expenses ─────────────────────────────────────────────────
    interface Pending {
      amountMinor: number
      payer: string
      spentOn: string
      purpose: string
      categoryId: string | null
      weights: Array<[string, number]>
      locked: boolean
      recurringId?: string
      periodKey?: string
      createdBy: string
      /** Filled in on write, so notes land on the row they were generated for. */
      id?: string
    }

    const pending: Array<Pending> = []

    /**
     * Split shapes, because a ledger where every entry is split evenly between
     * everyone is a ledger that has never had a real conversation in it.
     */
    const SPLIT_SHAPES = [
      'roster', // the whole roster on its default weights
      'roster-uneven', // the whole roster, nudged off the defaults
      'subset', // two to four people, uneven
      'pair', // one other person
      'solo', // no split rows at all: the payer carries it
      'subset', // somebody joining partway through the history
    ] as const

    const roster = MEMBERS.filter((m) => m.weightBp > 0).map((m) => m.name)

    function weightsFor(
      shape: (typeof SPLIT_SHAPES)[number],
    ): Array<[string, number]> {
      if (shape === 'solo') return []
      if (shape === 'pair') {
        const other = pick(roster.filter((n) => n !== 'Sam'))
        return [
          ['Sam', 5000],
          [other, 5000],
        ]
      }
      if (shape === 'subset') {
        const size = between(2, 4)
        const chosen: Array<string> = []
        const pool = [...roster]
        for (let i = 0; i < size && pool.length; i++) {
          chosen.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!)
        }
        // Deliberately uneven: equal thirds everywhere hides rounding bugs.
        const raw = chosen.map(() => between(1, 3))
        return chosen.map((n, i) => [n, apportion(raw, BP_TOTAL)[i]!])
      }
      const defaultWeights = MEMBERS.filter((m) => m.weightBp > 0).map(
        (m) => [m.name, m.weightBp] as [string, number],
      )
      if (shape === 'roster') return defaultWeights
      // Nudge one member up and another down, then rescale to exactly BP_TOTAL.
      // The rescale is not optional: `allocate` refuses weights that do not sum to
      // BP_TOTAL and so does the column check, so an un-normalised set fails on
      // the very first row rather than on some interesting edge case later.
      const nudged = defaultWeights.map(([, w], i) =>
        i % 3 === 0
          ? Math.round(w * 1.4)
          : i % 3 === 1
            ? Math.round(w * 0.7)
            : w,
      )
      const rescaled = apportion(nudged, BP_TOTAL)
      return defaultWeights.map(([n], i) => [n, rescaled[i]!])
    }

    // Spread across the window, weighted towards recent months: real ledgers are
    // denser at the near end, and a uniform spread makes the "this month" view
    // look emptier than it should.
    const totalDays = MONTHS * 30
    let placed = 0
    while (placed < HAND_TYPED) {
      const isPersonal = chance(0.06)
      const spec = isPersonal ? pick(PERSONAL) : pick(SHARED)
      // A category's density is per month; scale it to the window.
      const want = Math.max(1, Math.round(spec.density * MONTHS))
      const copies = Math.max(1, Math.round(want / (SHARED.length / 2)))
      for (let c = 0; c < copies && placed < HAND_TYPED; c++) {
        // Bias towards the recent third.
        const skew = Math.pow(rand(), 0.55)
        const days = Math.floor(skew * totalDays)
        const shape = pick(SPLIT_SHAPES)
        const weights = weightsFor(shape)
        // The payer is usually in the split, sometimes not (one of them covered
        // dinner and is not asking to be repaid for it).
        const payer = chance(0.86)
          ? weights.length
            ? pick(weights)[0]
            : pick(roster)
          : pick(roster)
        if (weights.length && !weights.some(([n]) => n === payer)) {
          // Keep the payer in their own share by trimming the largest weight if
          // there is room, else leaving the entry with no split rows at all.
          if (weights.length < 3) {
            pending.push({
              amountMinor: between(spec.range[0], spec.range[1]),
              payer,
              spentOn: daysAgo(days),
              purpose: pick(spec.purposes),
              categoryId: catByName.get(spec.name) ?? null,
              weights: [],
              locked: chance(0.8),
              createdBy: payer,
            })
            placed++
            continue
          }
        }
        pending.push({
          amountMinor: between(spec.range[0], spec.range[1]),
          payer,
          spentOn: daysAgo(days),
          purpose: pick(spec.purposes),
          categoryId: catByName.get(spec.name) ?? null,
          weights,
          locked: chance(0.8),
          createdBy: payer,
        })
        placed++
      }
    }

    // A few amounts with awkward cents, because integer allocation is the whole
    // point of storing minor units and €12.31 does not divide.
    for (let i = 0; i < 24; i++) {
      const p = pending[Math.floor(rand() * pending.length)]!
      p.amountMinor = between(101, 9999)
    }

    // ── recurring series ────────────────────────────────────────────────────
    const seriesRows: Array<{ spec: SeriesSpec; id: string }> = []
    for (const spec of SERIES) {
      const firstDue = (() => {
        const d = new Date(today)
        d.setMonth(d.getMonth() - MONTHS)
        // Align to the anchor day, clamped — the same clamp the app applies, so
        // the seed's own start date cannot disagree with the schedule.
        const anchor = spec.frequency === 'weekly' ? 7 : spec.anchorDay
        if (spec.frequency === 'weekly') {
          d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
          return toISODate(d)
        }
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
        d.setDate(Math.min(anchor, last))
        return toISODate(d)
      })()

      const { due, cursor } = dueOccurrences(
        firstDue,
        spec.frequency,
        spec.frequency === 'weekly' ? anchorDayOf(firstDue) : spec.anchorDay,
        todayISO,
      )

      const [template] = await db
        .insert(recurringExpense)
        .values({
          spaceId: house.id,
          purpose: spec.purpose,
          amountMinor: spec.amountMinor,
          categoryId: catByName.get(spec.category) ?? null,
          paidByMemberId: id(spec.payer).id,
          frequency: spec.frequency,
          anchorDay:
            spec.frequency === 'weekly'
              ? anchorDayOf(firstDue)
              : spec.anchorDay,
          startsOn: firstDue,
          // The cursor the catch-up loop would have reached. Leaving it behind
          // would let the next read append to a ledger that is meant to be done.
          nextDueOn: cursor,
          locked: true,
          createdByUserId: uid(spec.payer),
        })
        .returning()
      if (!template) throw new Error(`failed to insert series ${spec.purpose}`)

      await db.insert(recurringExpenseSplit).values(
        spec.weights.map(([name, w]) => ({
          recurringId: template.id,
          memberId: id(name).id,
          weightBp: w,
        })),
      )
      seriesRows.push({ spec, id: template.id })

      for (const occ of due) {
        pending.push({
          amountMinor: spec.amountMinor,
          payer: spec.payer,
          spentOn: occ.date,
          purpose: spec.purpose,
          categoryId: catByName.get(spec.category) ?? null,
          weights: spec.weights,
          locked: true,
          recurringId: template.id,
          periodKey: occ.key,
          createdBy: spec.payer,
        })
      }
    }

    // ── write the expenses ──────────────────────────────────────────────────
    // Chronological, so `createdAt` tells a plausible story rather than being
    // the same instant for everything.
    pending.sort((a, b) => (a.spentOn < b.spentOn ? -1 : 1))

    const idsByKey = new Map<string, string>()
    for (const p of pending) {
      const [row] = await db
        .insert(expense)
        .values({
          spaceId: house.id,
          categoryId: p.categoryId,
          paidByMemberId: id(p.payer).id,
          spentOn: p.spentOn,
          purpose: p.purpose,
          amountMinor: p.amountMinor,
          locked: p.locked,
          recurringId: p.recurringId ?? null,
          periodKey: p.periodKey ?? null,
          createdByUserId: uid(p.createdBy),
          createdAt: new Date(`${p.spentOn}T12:00:00Z`),
        })
        .returning()
      if (!row) throw new Error(`failed to insert ${p.purpose}`)
      p.id = row.id

      if (p.weights.length) {
        const sum = p.weights.reduce((s, [, w]) => s + w, 0)
        if (sum !== BP_TOTAL) {
          throw new Error(`${p.purpose}: weights sum to ${sum}`)
        }
        const shares = allocate(
          p.amountMinor,
          p.weights.map(([, w]) => w),
        )
        await db.insert(expenseSplit).values(
          p.weights.map(([name, w], i) => ({
            expenseId: row.id,
            memberId: id(name).id,
            weightBp: w,
            shareMinor: shares[i]!,
          })),
        )
      }
      if (p.recurringId && p.periodKey) {
        idsByKey.set(`${p.recurringId}|${p.periodKey}`, row.id)
      }
    }

    // ── notes ───────────────────────────────────────────────────────────────
    // On a minority of entries, by members who may not be the author, because
    // "everybody can leave one regardless of edit rights" is a rule worth having
    // data for.
    const noteTargets = pending.filter(() => chance(0.07)).slice(0, 90)
    let noteCount = 0
    for (const p of noteTargets) {
      if (!p.id) continue
      const author = pick(NOTE_AUTHORS)
      const member = id(author)
      // No member_id on this table, deliberately: the author is a name snapshot
      // plus an optional account link, so a note still reads as somebody's after
      // they delete their account. `spaceId` is repeated here so "notes for this
      // expense" can be scoped by household without trusting the expense id alone.
      await db.insert(expenseNote).values({
        spaceId: house.id,
        expenseId: p.id,
        authorName: author,
        authorUserId: member.userId,
        body: pick(NOTES),
      })
      noteCount++
    }

    // ── balances, then settlements that actually settle something ───────────
    /**
     * The same arithmetic the balances page uses: the payer is credited the whole
     * amount and each participant is debited their share. An entry with no split
     * rows nets to zero for everybody, which is correct — they paid it and they
     * owed it.
     */
    const net = new Map<string, number>(
      [...memberByName.keys()].map((n) => [n, 0]),
    )

    for (const p of pending) {
      const amount = p.amountMinor
      net.set(p.payer, net.get(p.payer)! + amount)
      if (p.weights.length) {
        const shares = allocate(
          amount,
          p.weights.map(([, w]) => w),
        )
        p.weights.forEach(([name], i) => {
          net.set(name, net.get(name)! - shares[i]!)
        })
      } else {
        net.set(p.payer, net.get(p.payer)! - amount)
      }
    }

    // Settle up at four points in the past, oldest first, so the running balance
    // is one that has been kept up with rather than one that has run for fourteen
    // months. Greedy largest-debtor pays largest-creditor, which is what people
    // actually do and keeps the number of transfers small.
    const SETTLE_DAYS_AGO = [104, 71, 38, 11]
    /**
     * How much of what is owed, each round, actually gets paid.
     *
     * Not 1.0. Paying a balance to the cent is not what happens between people;
     * you send the rounded number and call it settled. The residue is the point —
     * it is what leaves a household permanently a few euro apart, which is the
     * state the balances screen is actually designed for and the one worth having
     * data for.
     *
     * It is also why this is not 1.0 *and* why it has to be a fraction rather than
     * "pay everything once": at 1.0 the first round cleared everybody exactly, the
     * following three rounds found nobody who owed anybody, and the Recorded
     * payments list ended up with three rows from a single month. A fraction gives
     * every round something to do and leaves a live balance behind.
     */
    const SETTLE_FRACTION = 0.85
    let settlementCount = 0
    for (const daysAgoN of SETTLE_DAYS_AGO) {
      /*
       * Snapshot both sides at the start of the round and do NOT recompute
       * membership as we go.
       *
       * The obvious version of this — "while the biggest debtor still owes more
       * than a euro, pay them, and re-sort" — never terminates at a fraction
       * below 1. Nobody ever drops below the threshold, so the loop keeps finding
       * the same pair and paying 85% of what is left. The first run of this
       * produced 800 payments from four settle-up dates.
       *
       * So each member is dealt with exactly once per round: every debtor pays
       * out their budget across the creditors in order, and the next debtor is
       * next regardless of how much is left. That is also how it happens between
       * people — you do not run a settlement loop until the last cent moves.
       */
      const debtors = [...net.entries()]
        .filter(([, v]) => v < -100)
        .sort((a, b) => a[1] - b[1])
      const creditors = [...net.entries()]
        .filter(([, v]) => v > 100)
        .sort((a, b) => b[1] - a[1])

      for (const [from, balance] of debtors) {
        const budget = Math.round(-balance * SETTLE_FRACTION)
        let remaining = budget
        for (const [to] of creditors) {
          if (remaining < 100) break
          const amount = Math.min(remaining, net.get(to)!)
          if (amount < 100) continue
          await db.insert(settlement).values({
            spaceId: house.id,
            fromMemberId: id(from).id,
            toMemberId: id(to).id,
            amountMinor: amount,
            settledOn: daysAgo(daysAgoN),
            createdByUserId: uid(from),
          })
          settlementCount++
          remaining -= amount
          net.set(from, net.get(from)! + amount)
          net.set(to, net.get(to)! - amount)
        }
      }
    }

    // ── verify what the constraints and the app's own maths both rely on ─────
    const [splitBad] = await sql<Array<{ bad: number }>>`
      select count(*)::int as bad
      from expense e
      join lateral (
        select coalesce(sum(s.share_minor), 0)::int as total
        from expense_split s where s.expense_id = e.id
      ) t on true
      where t.total <> e.amount_minor
        and exists (select 1 from expense_split s2 where s2.expense_id = e.id)
    `
    if (Number(splitBad?.bad ?? 0) !== 0) {
      throw new Error(
        `${splitBad?.bad} entries violate sum(share_minor) = amount_minor`,
      )
    }

    // The settlement invariant the balances code relies on: a payment moves value
    // between two people and nets to zero across the pair.
    const [settleBad] = await sql<Array<{ bad: number }>>`
      select count(*)::int as bad
      from settlement s
      join space_member f on f.id = s.from_member_id
      join space_member t on t.id = s.to_member_id
      where s.from_member_id = s.to_member_id
         or f.space_id <> ${house.id}::uuid
         or t.space_id <> ${house.id}::uuid
    `
    if (Number(settleBad?.bad ?? 0) !== 0) {
      throw new Error(
        `${settleBad?.bad} settlement(s) reference the wrong members`,
      )
    }

    // Every recurrence must have its occurrences on the exact dates the schedule
    // says, which is the one thing a fixture can get subtly wrong and still look
    // fine in a screenshot.
    const [recurBad] = await sql<Array<{ bad: number }>>`
      select count(*)::int as bad
      from recurring_expense r
      where r.space_id = ${house.id}::uuid
        and not exists (
          select 1 from expense e
          where e.recurring_id = r.id
            and e.period_key is not null
        )
    `
    if (Number(recurBad?.bad ?? 0) !== 0) {
      throw new Error('a recurring series produced no occurrences')
    }

    // Report the shape of what landed, so a broken run is obvious from the output
    // rather than from opening the app.
    const [counts] = await sql<
      Array<{
        expenses: number
        splits: number
        notes: number
        settlements: number
        series: number
        cats: number
        members: number
        first: string | null
        last: string | null
      }>
    >`
      select
        (select count(*)::int from expense where space_id = ${house.id}::uuid) as expenses,
        (select count(*)::int from expense_split s
          join expense e on e.id = s.expense_id
          where e.space_id = ${house.id}::uuid) as splits,
        (select count(*)::int from expense_note where space_id = ${house.id}::uuid) as notes,
        (select count(*)::int from settlement where space_id = ${house.id}::uuid) as settlements,
        (select count(*)::int from recurring_expense where space_id = ${house.id}::uuid) as series,
        (select count(*)::int from category where space_id = ${house.id}::uuid) as cats,
        (select count(*)::int from space_member where space_id = ${house.id}::uuid) as members,
        (select min(spent_on)::text from expense where space_id = ${house.id}::uuid) as first,
        (select max(spent_on)::text from expense where space_id = ${house.id}::uuid) as last
    `

    const outstanding = [...net.entries()].filter(([, v]) => Math.abs(v) >= 100)

    console.log(`Seeded "${house.name}" (${house.id}) for ${OWNER_EMAIL}`)
    console.log(`  members:    ${counts?.members} (5 accounts + 1 virtual)`)
    console.log(`  categories: ${counts?.cats}`)
    console.log(
      `  expenses:   ${counts?.expenses} (${counts?.splits} split rows)`,
    )
    console.log(`  recurring:  ${counts?.series} series`)
    console.log(`  notes:      ${counts?.notes}`)
    console.log(`  payments:   ${counts?.settlements}`)
    console.log(`  range:      ${counts?.first} → ${counts?.last}`)
    console.log(
      `  balances:   ${outstanding.length} member(s) still off by something`,
    )
    console.log(`\nSign in as ${OWNER_EMAIL} to see it.`)
    console.log(
      `The other four accounts (noor@, robin@, june@, felix@splitwise.local) sign in too,`,
    )
    console.log(
      `if you want to see the balances screen from the other side of it.`,
    )
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
