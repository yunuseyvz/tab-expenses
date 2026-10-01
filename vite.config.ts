import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * NOTE ON NITRO
 *
 * The plan asks for the Nitro build shape, where `pnpm build` emits a
 * self-contained `.output/` run with `node .output/server/index.mjs`. That was
 * tried and does not work at this version combination: adding the `nitro/vite`
 * plugin (3.0.0, the only line that exports it — 2.x has no `/vite` entry)
 * makes *every* request abort with an AbortError, including a server route
 * whose entire handler is `Response.json({ ok: true })`. So the failure is in
 * the build/runtime integration, not in application code.
 *
 * This therefore uses Start's own default shape: `dist/client` plus a
 * fetch-style `dist/server/server.js`, served by srvx. That is the framework's
 * documented default and what the official start-basic-react-query example
 * does, and it is what the Docker image and scripts/dev-serve.sh run.
 *
 * Re-check on a Start or nitro upgrade; if `nitro/vite` starts serving
 * correctly, dropping the srvx wrapper in favour of `.output/` is a small
 * change confined to the Dockerfile, the `start` script, and dev-serve.sh.
 */
export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  // Vite inlines every VITE_* variable into the client bundle at build time.
  // Secrets are read from process.env at runtime instead - see src/lib/db/env.ts
  // and scripts/check-no-vite-env.mjs.
  envPrefix: ['VITE_APP_NAME', 'VITE_APP_URL'],
  plugins: [
    tailwindcss(),
    // react's vite plugin must come after start's vite plugin
    tanstackStart(),
    viteReact(),
  ],
})
