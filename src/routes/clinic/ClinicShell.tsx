import { Link, Outlet } from '@tanstack/react-router'

/**
 * The clinician shell. ADR 21 keeps this side deliberately plainer than the
 * operator side: no sidebar, no pipeline stages, no sim clock, because a GP
 * has one patient in front of them and none of that is their job. The link to
 * `/ops` stays discreet rather than becoming navigation, since crossing into
 * the operator side is a demo move, not part of the clinical flow.
 */
export function ClinicShell() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <Link to="/" className="text-sm font-medium">
          NHS Onboard
        </Link>
        <Link
          to="/ops"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Operator
        </Link>
      </header>
      <div className="flex-1 p-6">
        <Outlet />
      </div>
    </div>
  )
}
