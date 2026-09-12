import { Link, Outlet } from '@tanstack/react-router'
import { LayoutDashboardIcon, BookOpenTextIcon } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { SimClock } from './board/SimClock'

/**
 * The operator side only. ADR 21 puts everything with a pipeline in it under
 * `/ops`, so the clinician never meets this sidebar. Every entry links: a
 * permanently disabled button is noise, so a section without a route is left
 * out until it has one.
 */
const NAV = [
  { label: 'Board', icon: LayoutDashboardIcon, to: '/ops' },
  { label: 'Rules', icon: BookOpenTextIcon, to: '/ops/rules' },
] satisfies { label: string; icon: typeof LayoutDashboardIcon; to: '/ops' | '/ops/rules' }[]

/** The operator shell. See ADR 21 for why the clinician side has its own. */
export function AppLayout() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-3 py-3 text-sm font-medium">NHS Onboard</SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    {/* Exact, or `/ops` would read as active on every page under it. */}
                    <Link to={item.to} activeOptions={{ exact: true }}>
                      {({ isActive }) => (
                        <SidebarMenuButton isActive={isActive}>
                          <item.icon />
                          {item.label}
                        </SidebarMenuButton>
                      )}
                    </Link>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SimClock />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex items-center gap-2 border-b border-border p-3">
          <SidebarTrigger />
        </header>
        <div className="flex-1 p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
