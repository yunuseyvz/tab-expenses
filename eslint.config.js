import { tanstackConfig } from '@tanstack/eslint-config'

/**
 * `tanstackConfig` is a flat-config array (not a factory). We only add global
 * ignores on top of it — see the package's dist/index.d.ts.
 */
export default [
  {
    ignores: [
      '.output/**',
      '.nitro/**',
      'dist/**',
      'node_modules/**',
      'drizzle/**',
      'src/routeTree.gen.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...tanstackConfig,
]
