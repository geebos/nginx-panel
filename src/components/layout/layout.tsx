import * as React from "react";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocalStorage } from "@/hooks/use-storage";
import { Sidebar, Tabbar } from "./navigate";

// Collapsed sidebar shows icon stacked over smaller label, so it needs more
// width than shadcn's default 3rem (which only fits a square icon).
const SIDEBAR_WIDTH_ICON = "4rem";
const SIDEBAR_OPEN_KEY = "sidebar:open";

export function Layout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useLocalStorage(
    SIDEBAR_OPEN_KEY,
    true,
  );

  const toaster = <Toaster position="top-center" richColors />

  if (isMobile) {
    return (
      <div className="flex min-h-svh max-h-svh flex-col bg-secondary text-foreground">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
        <Tabbar />
        {toaster}
      </div>
    );
  }

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      style={{ "--sidebar-width-icon": SIDEBAR_WIDTH_ICON } as React.CSSProperties}
    >
      <Sidebar />
      <SidebarInset>
        {children}
        {toaster}
      </SidebarInset>
    </SidebarProvider>
  );
}
