import { Link, Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import App from './App'
import { Rules } from './routes/Rules'

/**
 * The route tree, in code. No file-based routing plugin, so the build has no
 * codegen step.
 *
 * Two routes for now, and no sidebar: the shell the UI conventions describe
 * carries the sim clock and the world name, which the board slice owns. The
 * nav below is the smallest thing that makes /rules reachable.
 */

function Shell() {
  return (
    <div className="flex flex-col">
      <nav className="flex gap-4 border-b border-border p-4 text-sm">
        <Link to="/">Board</Link>
        <Link to="/rules">Rules</Link>
      </nav>
      <Outlet />
    </div>
  )
}

const rootRoute = createRootRoute({ component: Shell })

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: App,
})

const rulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rules',
  component: Rules,
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([boardRoute, rulesRoute]),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
