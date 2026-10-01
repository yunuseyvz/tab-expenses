# Tab

A shared household expense ledger. Replaces a spreadsheet of
`date / purpose / amount` with categories, percentage splits, and a settlement
view: _"Vale owes you €40"_.

Mobile-first, because the entry point is a phone at a checkout.

```bash
cp .env.example .env          # then fill it in
docker compose --profile dev up --build
```

The app is on <http://localhost:3000>, Mailpit on <http://localhost:8025>.
Sign in as `demo@tab.local`; the code lands in Mailpit instead of a real
inbox. The seeded space is a German household with rent, groceries, a 5¢ bread,
and a 60/40 split.

> Use **`localhost`**, not `127.0.0.1`. `BETTER_AUTH_URL` doubles as the
> allowed-Origin list, and the two are different origins to a browser — so
> `127.0.0.1` is refused with `Invalid origin: …` even though it reaches the
> same server.

Prefer running the app outside a container, for hot reload? That needs Postgres
published on a host port, which the base compose file deliberately does not do:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d
pnpm db:migrate && pnpm db:seed && pnpm dev
```

---

## What it does

- **Spaces** with shared and personal category scopes.
- **Members**, including _virtual_ members — Vater and Vale carry a share
  without ever registering (`space_member.user_id` is nullable).
- **Percentage splits** per expense, stored as integer basis points summing to
  10 000, with the cents derived once at write time.
- **Totals** for the whole ledger or for an arbitrary selection of categories.
- **Balances and a settlement plan**: per member `paid − share`, and at most
  `n−1` transfers to square everyone up.
- **Passwordless email OTP** login.
- **CSV import/export** — the migration path off the spreadsheet.

## Stack

| Layer       | Choice                                       | Why this one                                                        |
| ----------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Framework   | TanStack Start 1.168 on Vite 8               | Server functions, type-safe routing, small client bundle            |
| RSC         | **Off, deliberately**                        | Still experimental; Start's native model covers this app without it |
| Data        | PostgreSQL 17 + Drizzle 0.45                 | Constraints carry the split invariants                              |
| Auth        | Better Auth 1.7 + emailOTP                   | First-party TanStack Start integration                              |
| Client data | TanStack Query                               | Filter state in the query key; explicit invalidation                |
| UI          | Tailwind v4, hand-rolled warm-tactile tokens | OKLCH, two-part shadows, static paper grain                         |
| Motion      | Motion 13                                    | Layout and presence; CSS transitions for hover/press                |
| Money       | Integer minor units, always                  | A float never crosses the boundary                                  |

All versions are pinned exactly in `package.json`.

## Money, and why it is the way it is

Amounts are **integer minor units** everywhere. Splits are **integer basis
points** that must total 10 000, converted to cents with the largest-remainder
method so the shares always sum to exactly the amount.

Each `expense_split` row stores both:

- `weight_bp` — the editable intent, which survives an amount edit.
- `share_minor` — the derived cents, frozen at write time.

Summing thousands of rows is then exact, and the percentage on screen is the one
that was actually charged. The invariant `sum(share_minor) = amount_minor` is
re-asserted _inside the write transaction_ against what actually landed in the
table, so a bug in `allocate()` cannot silently corrupt the ledger.

```ts
allocate(10000, [6000, 4000]) // → [6000, 4000]  (€100, 60/40)
allocate(5, [5000, 3000, 2000]) // → [3, 1, 1]
allocate(1, [6000, 4000]) // → [1, 0]  — the payer absorbs the odd cent
```

> The plan's example table lists the 5¢ case as `3 / 2 / 0`. That sums to 5 but
> is not a valid 50/30/20 allocation — the 20% share would be 1 cent, not 0. The
> largest-remainder result is `3 / 1 / 1`, and that is what the code does. See
> `src/lib/money.ts` and its test.

## Auth: two layers, and why the second one is the one that matters

**Layer 1 — navigation guard.** `_protected.tsx` runs `beforeLoad`, which fires
on every navigation _including_ client-side `<Link>` clicks. That is a real
advantage over middleware that only sees HTTP requests. It is UX.

**Layer 2 — server-function guard.** `beforeLoad` does **not** protect server
functions. They are directly callable HTTP endpoints, and a router guard is
irrelevant to someone POSTing to them directly. So every server function calls
`ensureSession()` and then `requireSpaceMember()` itself. This is the security
boundary.

`requireSpaceMember` returns `Not found` for both "not your space" and "no such
space", so it cannot be used to probe which space ids exist.

Three settings in `src/lib/auth.ts` are load-bearing rather than stylistic:

- `storeOTP: 'hashed'` — the plugin's default is plain text, which means a
  database dump hands over live login codes.
- `tanstackStartCookies()` **last** in the plugin array — without it any call
  that sets a cookie fails to persist through Start's SSR. This is the single
  most common TanStack Start auth bug: login "succeeds" and then lands
  unauthenticated.
- `trustedProxyHeaders` — so the rate limiter reads the real client IP from
  `X-Forwarded-For` rather than the proxy hop.

## Commands

```bash
pnpm dev              # dev server on :3000
pnpm build            # → dist/ (see "Build shape" below)
pnpm serve            # build output on a free port, for testing
pnpm stop

pnpm db:generate      # write a migration from the schema
pnpm db:migrate       # apply migrations
pnpm db:seed          # a demo space with a household's worth of history
pnpm db:verify-constraints   # assert the schema's invariants against real Postgres

pnpm typecheck
pnpm lint
pnpm test             # 65 unit + integration tests
                      # (the integration ones need a database; without one they
                      #  skip loudly. REQUIRE_DB=true makes that a failure —
                      #  which is what CI uses.)
pnpm test:e2e         # 20 Playwright tests: brings up Postgres, Mailpit, builds, serves, runs
pnpm check            # typecheck + lint + test + auth-guard check

pnpm guard:auth       # every server function checks session and space membership
pnpm guard:vite-env   # no secret may use the VITE_ prefix
```

## Configuration

Every secret is read from `process.env` **at runtime**, through
`src/lib/db/env.ts`. Vite inlines any `VITE_*` variable into the client bundle
at build time, so `VITE_` names are for public values only. `pnpm guard:vite-env`
enforces the allowlist, and CI additionally greps the built client assets for
server-only values.

| Variable                      | Notes                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | Postgres connection string                                                                                                                   |
| `BETTER_AUTH_SECRET`          | `openssl rand -base64 32`                                                                                                                    |
| `BETTER_AUTH_URL`             | Public origin — **and the allowed-Origin list**                                                                                              |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Extra hostnames, comma separated. Needed to reach the app by more than one name (Tailscale hostname, LAN IP), otherwise: `Invalid origin: …` |
| `TRUSTED_PROXY_HEADERS`       | `true` behind Traefik/Coolify                                                                                                                |
| `RESEND_API_KEY`              | Blank in dev → Mailpit                                                                                                                       |
| `EMAIL_FROM`                  | RFC 5322 address                                                                                                                             |
| `MAILPIT_API_URL`             | Dev only; Mailpit's **HTTP** port, not SMTP                                                                                                  |
| `VITE_APP_NAME`               | The only build-time value                                                                                                                    |

## Deployment

`docker compose up --build` starts the app and Postgres. In production, point
Coolify at the compose file; its Traefik terminates TLS in front of `app:3000`.

The container entrypoint waits for Postgres, validates the configuration,
applies migrations, then serves — as a non-root user, with a healthcheck.

**Migrations on boot are safe for the single replica this is written for.** If
you scale horizontally, move migration to a separate one-shot job; concurrent
`drizzle-kit migrate` runs can race on the migrations table.

### Build shape

The plan asked for Nitro's self-contained `.output/`, run with
`node .output/server/index.mjs`. That was implemented and **does not work at
these versions**: adding the `nitro/vite` plugin (3.0.0, the only line that
exports it — 2.x has no `/vite` entry) makes _every_ request abort with an
`AbortError`, including a server route whose whole handler is
`Response.json({ ok: true })`. The failure is in the build/runtime integration,
not in application code.

This therefore uses Start's own default shape: `dist/client` plus a fetch-style
`dist/server/server.js`, served by `srvx`. That is the framework's documented
default and what the official `start-basic-react-query` example does. See the
note in `vite.config.ts` — if `nitro/vite` starts serving correctly on a
future upgrade, switching back is a change confined to the Dockerfile, the
`start` script, and `scripts/dev-serve.sh`.

## Testing

| Layer       | What it covers                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| Unit        | Split allocation, CSV round-trip, settlement maths, period/date handling, Zod validators                         |
| Integration | Cross-household isolation and the split invariant, against real Postgres                                         |
| E2E         | The real OTP flow through Mailpit, SSR completeness, the split editor, balances, contrast, focus, reduced motion |

`pnpm test:e2e` is the interesting one: it boots Postgres and Mailpit, migrates,
seeds, builds, serves on a free port, and drives a phone-sized browser. It
signs in through the real email flow rather than a test-only bypass.

Two guards exist because the failure they catch is invisible in review:

- `guard:auth` fails the build if a server function forgets its membership
  check — the plan's highest-severity risk.
- `guard:vite-env` fails if a secret acquires a `VITE_` prefix.

## Known limitations

- **Image size.** The runtime image is ~895 MB on disk. Most of that is the
  `node_modules` layer copied from the build stage, which the container then
  prunes — so the _running_ container is ~410 MB but the layer history keeps the
  original bytes. Pruning in a later layer cannot reclaim them; a dedicated
  migration stage, or running migrations as a separate job, would.
- **Single currency per space**, by design. No FX.
- **No recurring expenses.** A spreadsheet implies them; v1 is manual.
- **No receipts or attachments**, and therefore no object storage.
- **English only.** Strings are not externalised yet.
- `expiresIn`/`updateAge` on the session, and the OTP parameters, are set but
  not user-configurable.
