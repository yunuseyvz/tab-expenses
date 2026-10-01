/**
 * The one genuinely public, build-time value.
 *
 * `VITE_` is the only prefix Vite inlines into the client bundle, so it is
 * reserved for values that are safe to publish. Everything else is read from
 * `process.env` at runtime via `src/lib/db/env.ts` — see
 * `scripts/check-no-vite-env.mjs`, which enforces the allowlist.
 *
 * Reading it through a helper rather than `import.meta.env` at each call site
 * means a missing value cannot silently produce `undefined` in a page title.
 */
const fromEnv = import.meta.env.VITE_APP_NAME

export const APP_NAME =
  typeof fromEnv === 'string' && fromEnv.trim().length > 0
    ? fromEnv.trim()
    : 'Splitwise'
