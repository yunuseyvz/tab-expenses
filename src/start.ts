import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

export const startInstance = createStart(() => ({
  requestMiddleware: [
    // Server functions are POST endpoints reachable by anything that can reach
    // the origin. The origin check blocks cross-site form posts; the real
    // authorisation boundary is requireSpaceMember in every server function.
    createCsrfMiddleware({
      filter: (ctx) => ctx.handlerType === 'serverFn',
    }),
  ],
}))
