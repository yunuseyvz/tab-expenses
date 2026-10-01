# syntax=docker/dockerfile:1
#
# Three stages: install, build, run.
#
# The runtime stage carries only what it needs to serve — the built output, the
# migration SQL, and drizzle-kit to apply it. No source, no app devDependencies.
#
# Build shape note: Start's default output is dist/client plus a fetch-style
# dist/server/server.js, served by srvx. The plan asked for Nitro's
# self-contained .output/, but `nitro/vite` aborts every request at these
# versions — see the note in vite.config.ts.

# ── deps ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps

# Corepack pins pnpm to the version in package.json's packageManager field, so
# the image cannot drift from the lockfile's expectations.
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate

WORKDIR /app
# Only the manifests, so this layer is cached until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── build ──────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build

RUN corepack enable && corepack prepare pnpm@12.8.1 --activate

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Vite inlines VITE_* at build time, so the only variable needed here is the
# genuinely public app name. Every secret is read from process.env at RUNTIME;
# see src/lib/db/env.ts and scripts/check-no-vite-env.mjs.
ENV VITE_APP_NAME=Splitwise
RUN pnpm build

# ── runtime ────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

# tini reaps zombies and forwards signals, so node receives SIGTERM from the
# orchestrator and shuts down cleanly instead of waiting out the kill timeout
# on every deploy.
RUN apk add --no-cache tini

ENV NODE_ENV=production
WORKDIR /app

# Toolchain first: srvx (the server) and drizzle-kit (migrations) both live in
# the deps stage's node_modules, so the copy has to happen before anything else
# writes into that directory. Installing them again with npm on top of pnpm's
# symlinked tree fails partway through the overlay.
COPY --from=deps /app/node_modules ./node_modules

# The built client assets and the server entry.
COPY --from=build --chown=node:node /app/dist ./dist
# Migrations, applied at boot by the entrypoint.
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build --chown=node:node /app/package.json ./package.json
# The schema is read at runtime by both the app and drizzle-kit.
COPY --from=build --chown=node:node /app/src/lib/db ./src/lib/db

# Trim the build-and-test toolchain out of the runtime image.
#
# The deps stage installs everything because the build needs it, and pnpm's
# content-addressed store means those packages sit in the same node_modules we
# copy from. None of these are used to serve a request:
# Playwright, jsdom, Vitest, Prettier, the bundler's native bindings, and
# Prisma/better-sqlite3 (present only because drizzle-orm lists them as optional
# peers).
#
# esbuild is the exception and is deliberately KEPT: drizzle-kit requires it to
# load the TypeScript schema, and an earlier version of this file deleted it.
# The container smoke test in CI applies migrations on every build, which is
# what turned that mistake into a red build rather than a broken deploy.
RUN set -eux; \
    for pkg in \
      '@playwright' 'playwright-core' 'playwright' \
      'jsdom' '@vitest' 'vitest' 'vite' \
      'prettier' 'typescript' '@types' \
      '@rolldown' 'rolldown' \
      'lightningcss' '@tailwindcss' 'tailwindcss' \
      '@prisma' 'prisma' 'better-sqlite3' ; do \
      rm -rf "node_modules/$pkg" || true; \
      # pnpm store directory names are `<name>@<version>` for unscoped and
      # `@scope+sub@<version>` for scoped, optionally followed by `_peers`. The
      # `+` form is why a plain "$pkg@*" glob silently misses the native
      # bindings — hence the second pattern.
      find node_modules/.pnpm -maxdepth 1 -name "$pkg@*" -exec rm -rf {} + 2>/dev/null || true; \
      find node_modules/.pnpm -maxdepth 1 -name "$pkg+*@*" -exec rm -rf {} + 2>/dev/null || true; \
    done; \
    rm -rf node_modules/.bin/playwright node_modules/.bin/vitest \
           node_modules/.bin/prettier node_modules/.bin/tsc || true

COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Unprivileged. The node image already provides uid 1000.
USER node

EXPOSE 3000
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
# The static dir is resolved relative to the server entry, not the working dir.
CMD ["./node_modules/.bin/srvx", "--prod", "--port", "3000", "-s", "../client", "./dist/server/server.js"]
