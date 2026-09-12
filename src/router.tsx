import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppLayout } from './routes/AppLayout'
import { Board } from './routes/board/Board'
import { Review } from './routes/review/Review'
import { Rules } from './routes/Rules'
import { PatientPage } from './routes/patient/PatientPage'

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

/** Splits source documents against the extracted record. See ADR 10. */
const patientRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patient/$id',
  component: PatientPage,
})

/** The GP review screen for one patient. */
const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patient/$id/review',
  component: Review,
})

const routeTree = rootRoute.addChildren([indexRoute, rulesRoute, patientRoute, reviewRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
