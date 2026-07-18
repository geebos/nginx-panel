import Link from "next/link";
import { useRouter } from "next/router";
import {
  Sidebar as SidebarPrimitive,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import {
  SparklesIcon,
  ListTodoIcon,
  FlaskConicalIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

export const navItems: NavItem[] = [
  { title: "Demo", href: "/", icon: SparklesIcon },
  { title: "Todo", href: "/todo/", icon: ListTodoIcon },
  { title: "Test", href: "/test/", icon: FlaskConicalIcon },
];

// `useRouter().pathname` returns the route without a trailing slash (e.g. "/buttons"),
// while navItems hrefs are stored with one (e.g. "/buttons/") per trailingSlash: true.
// Normalize both sides before comparing.
function isActive(pathname: string, href: string) {
  return pathname.replace(/\/$/, "") === href.replace(/\/$/, "");
}

function NavButton({ item, active }: { item: NavItem; active: boolean }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      data-collapsed={collapsed}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center rounded-md transition-colors",
        collapsed
          ? "flex-col gap-1 px-1 py-2 text-[10px] leading-none"
          : "gap-2 px-2 py-1.5 text-sm",
        active
          ? "bg-primary text-primary-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className={cn("shrink-0", collapsed ? "size-3.5" : "size-4")} />
      <span className={cn("truncate", collapsed && "max-w-full")}>{item.title}</span>
    </Link>
  );
}

export function Sidebar() {
  const { pathname } = useRouter();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  return (
    <SidebarPrimitive collapsible="icon">
      <SidebarHeader
        className={cn(
          "border-b border-sidebar-border px-2 py-3",
          collapsed ? "flex justify-center" : "flex-row items-center",
        )}
      >
        <span
          className={cn(
            "font-heading font-semibold tracking-tight",
            collapsed ? "text-sm" : "text-lg",
          )}
        >
          Apple
        </span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <NavButton item={item} active={isActive(pathname, item.href)} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border px-2 py-2">
        <SidebarTrigger className="w-full rounded-md py-2 hover:bg-sidebar-accent" />
      </SidebarFooter>
    </SidebarPrimitive>
  );
}

export function Tabbar() {
  const router = useRouter();
  const { pathname } = router;

  return (
    <nav
      aria-label="Primary"
      className="relative z-50 flex shrink-0 select-none items-stretch border-t border-border bg-background/95 backdrop-blur [touch-action:manipulation] md:hidden pb-[env(safe-area-inset-bottom)]"
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActiveItem = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActiveItem ? "page" : undefined}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" || isActiveItem) return;

              event.preventDefault();
              void router.push(item.href);
            }}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2 transition-colors",
              isActiveItem
                ? "text-primary"
                : "text-muted-foreground/60 hover:text-foreground",
            )}
          >
            <Icon className="size-5" />
            <span className="text-[10px] leading-none">{item.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}
