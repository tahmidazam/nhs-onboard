import { Link, Outlet } from '@tanstack/react-router'
import { LayoutDashboardIcon, BookOpenTextIcon, DatabaseIcon } from 'lucide-react'
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

/** A route-less entry stays disabled rather than linking nowhere. */
const NAV = [
  { label: 'Board', icon: LayoutDashboardIcon, to: '/' },
  { label: 'Rules', icon: BookOpenTextIcon, to: '/rules' },
  { label: 'Sources', icon: DatabaseIcon },
] satisfies { label: string; icon: typeof LayoutDashboardIcon; to?: '/' | '/rules' }[]

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
                    {item.to ? (
                      <Link to={item.to}>
                        {({ isActive }) => (
                          <SidebarMenuButton isActive={isActive}>
                            <item.icon />
                            {item.label}
                          </SidebarMenuButton>
                        )}
                      </Link>
                    ) : (
                      <SidebarMenuButton disabled>
                        <item.icon />
                        {item.label}
                      </SidebarMenuButton>
                    )}
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
