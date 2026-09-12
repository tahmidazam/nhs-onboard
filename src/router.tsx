import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppLayout } from './routes/AppLayout'
import { Board } from './routes/board/Board'
import { Review } from './routes/review/Review'
import { Rules } from './routes/Rules'

const rootRoute = createRootRoute({
  component: AppLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Board,
})

/**
 * The pack and its citations. ADR 13 dropped YAML on the promise that
 * legibility would come from a generated view, so this route is what makes
 * ADR 5's claim checkable rather than taken on trust.
 */
const rulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rules',
  component: Rules,
})

/**
 * The GP review screen for one patient. A sibling agent owns `/patient/:id`
 * and the rest of `src/routes/patient/`; this route lives under
 * `src/routes/review/` instead so the two branches touch different files.
 */
const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patient/$id/review',
  component: Review,
})

const routeTree = rootRoute.addChildren([indexRoute, rulesRoute, reviewRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
