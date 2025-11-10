"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Code2,
  Compass,
  FolderPlus,
  History,
  Home,
  LayoutDashboard,
  Lightbulb,
  type LucideIcon,
  Plus,
  Settings,
  Star,
  Terminal,
  Zap,
  Database,
  FlameIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import Image from "next/image"

// Define the interface for a single playground item, icon is now a string
interface PlaygroundData {
  id: string
  name: string
  icon: string // Changed to string
  starred: boolean
}

// Map icon names (strings) to their corresponding LucideIcon components
const lucideIconMap: Record<string, LucideIcon> = {
  Zap: Zap,
  Lightbulb: Lightbulb,
  Database: Database,
  Compass: Compass,
  FlameIcon: FlameIcon,
  Terminal: Terminal,
  Code2: Code2, // Include the default icon
}

export function DashboardSidebar({ initialPlaygroundData }: { initialPlaygroundData: PlaygroundData[] }) {
  const pathname = usePathname()
  const [starredPlaygrounds, setStarredPlaygrounds] = useState(initialPlaygroundData.filter((p) => p.starred))
  const [recentPlaygrounds, setRecentPlaygrounds] = useState(initialPlaygroundData)

  useEffect(() => {
    const onDeleted = (e: Event) => {
      const evt = e as CustomEvent<{ id: string }>
      const id = evt.detail?.id
      if (!id) return
      setRecentPlaygrounds((prev) => prev.filter((p) => p.id !== id))
      setStarredPlaygrounds((prev) => prev.filter((p) => p.id !== id))
    }
    const onRenamed = (e: Event) => {
      const evt = e as CustomEvent<{ id: string, name: string }>
      const { id, name } = evt.detail || {} as any
      if (!id || name == null) return
      setRecentPlaygrounds((prev) => prev.map((p) => p.id === id ? { ...p, name } : p))
      setStarredPlaygrounds((prev) => prev.map((p) => p.id === id ? { ...p, name } : p))
    }
    window.addEventListener('dashboard:project-deleted', onDeleted as EventListener)
    window.addEventListener('dashboard:project-renamed', onRenamed as EventListener)
    return () => {
      window.removeEventListener('dashboard:project-deleted', onDeleted as EventListener)
      window.removeEventListener('dashboard:project-renamed', onRenamed as EventListener)
    }
  }, [])

  return (
    <Sidebar variant="inset" collapsible="icon" className="border-1 border-r">
      <SidebarContent>

        <SidebarGroup>
          <SidebarGroupLabel>
            <History className="h-4 w-4 mr-2" />
            Recent
          </SidebarGroupLabel>
      
          <SidebarGroupContent>
            <SidebarMenu>
              {starredPlaygrounds.length === 0 && recentPlaygrounds.length === 0 ? null : (
                recentPlaygrounds.map((playground) => {
                  const IconComponent = lucideIconMap[playground.icon] || Code2;
                  return (
                    <SidebarMenuItem key={playground.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === `/playground/${playground.id}`}
                        tooltip={playground.name}
                      >
                        <Link href={`/playground/${playground.id}`}>
                          {IconComponent && <IconComponent className="h-4 w-4" />}
                          <span>{playground.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })
              )}
              
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
