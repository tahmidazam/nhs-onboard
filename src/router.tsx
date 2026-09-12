import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import { ClinicShell } from './routes/clinic/ClinicShell'
import { ClinicList } from './routes/clinic/ClinicList'
import { PatientReview } from './routes/clinic/PatientReview'
import { AppLayout } from './routes/AppLayout'
import { Board } from './routes/board/Board'
import { Rules } from './routes/Rules'
import { PatientPage } from './routes/patient/PatientPage'

/**
 * ADR 21 splits the app into a clinician shell and an operator shell, so the
 * root holds no chrome of its own and each shell owns its own frame. Both are
 * pathless layout routes, `id` and no `path`, which is how a shell wraps a URL
 * without appearing in it. The underscore marks them pathless, so a route id
 * reads `/_operator/ops` and never collides with a real segment. Routing stays
 * code-defined per the UI conventions: no file-based plugin, so no codegen
 * step in the build.
 */
const rootRoute = createRootRoute({
  component: () => <Outlet />,
})

/** The clinician side. `/` and `/patient/$id` are what a GP ever sees. */
const clinicRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_clinic',
  component: ClinicShell,
})

const clinicListRoute = createRoute({
  getParentRoute: () => clinicRoute,
  path: '/',
  component: ClinicList,
})

/**
 * One patient, ready to sign off. The review used to hang off the operator's
 * document view as a child route. ADR 21 makes it the clinician's whole
 * screen, so it takes the bare path and that child route is gone.
 */
const patientReviewRoute = createRoute({
  getParentRoute: () => clinicRoute,
  path: '/patient/$id',
  component: PatientReview,
})

/** The operator side, everything under `/ops`. Sidebar, board, pipeline. */
const opsRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_operator',
  component: AppLayout,
})

const boardRoute = createRoute({
  getParentRoute: () => opsRoute,
  path: '/ops',
  component: Board,
})

/**
 * The pack and its citations. ADR 13 dropped YAML on the promise that
 * legibility would come from a generated view, so this route is what makes
 * ADR 5's claim checkable rather than taken on trust.
 */
const rulesRoute = createRoute({
  getParentRoute: () => opsRoute,
  path: '/ops/rules',
  component: Rules,
})

/** Splits source documents against the extracted record. See ADR 10. */
const patientRoute = createRoute({
  getParentRoute: () => opsRoute,
  path: '/ops/patient/$id',
  component: PatientPage,
})

const routeTree = rootRoute.addChildren([
  clinicRoute.addChildren([clinicListRoute, patientReviewRoute]),
  opsRoute.addChildren([boardRoute, rulesRoute, patientRoute]),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
