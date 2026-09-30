import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
    // Nitro wraps the build into a self-contained .output/ that runs on plain
    // node, which is what the runtime Docker image ships.
    nitro(),
    viteReact(),
  ],
})
