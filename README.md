<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/logo-light.png">
    <img src="docs/images/logo-dark.png" alt="Tab" width="340">
  </picture>
</div>

<div align="center">
  <p>A shared household expense ledger, with percentage splits and a settlement view.</p>
</div>

---

## Running it

```bash
cp .env.example .env
docker compose --profile dev up --build
```

App on <http://localhost:3000>, mail on <http://localhost:8025>. Sign in as `demo@tab.local` and read the code out of Mailpit. The seed gives you a household with three members and a few months of history.

<details>
<summary>If something's wrong</summary>

**`Invalid origin` on sign-in.** Use `localhost`, not `127.0.0.1`. `BETTER_AUTH_URL` doubles as the allowed-Origin list and they're different origins to a browser.

**`ECONNREFUSED` from the host.** Postgres isn't published. The base compose file deliberately doesn't publish it, so always pass both files:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d
pnpm db:migrate && pnpm db:seed && pnpm dev
```

**Docker changes seem to do nothing.** Rebuild: `up -d --build`.

</details>

## Stack

TanStack Start on Vite, PostgreSQL with Drizzle, Better Auth with email OTP, Tailwind v4.

## Scripts

```bash
pnpm dev          # dev server
pnpm db:migrate   # apply migrations
pnpm db:seed      # demo household
pnpm test         # unit + integration
pnpm test:e2e     # Playwright, real login flow
pnpm check        # typecheck, lint, test, guards
```

## Deploying

`docker compose up --build` runs the app and Postgres. Put a reverse proxy in front of it for TLS and delete the `ports:` block under `app:` first, or you publish 3000 on the host and bypass the proxy entirely.

Set `BETTER_AUTH_URL` to your public origin, `BETTER_AUTH_SECRET` to `openssl rand -base64 48`, and `RESEND_API_KEY` for login mail. Leave `DATABASE_URL` alone; the compose file builds it from the `POSTGRES_*` variables.

Migrations run on boot, so run a single replica.

## Licence

[MIT](LICENSE)
