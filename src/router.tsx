import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppLayout } from './routes/AppLayout'
import { Board } from './routes/board/Board'
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

const routeTree = rootRoute.addChildren([indexRoute, rulesRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
