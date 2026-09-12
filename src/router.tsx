import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppLayout } from './routes/AppLayout'
import { Board } from './routes/board/Board'

const rootRoute = createRootRoute({
  component: AppLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Board,
})

const routeTree = rootRoute.addChildren([indexRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
