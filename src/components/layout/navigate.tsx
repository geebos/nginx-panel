import { LocalizedLink } from "@/components/i18n/localized-link";
import { useRouter } from "next/router";
import { useTranslation } from "react-i18next";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getDashboard } from "@/lib/api";
import { useApiQuery } from "@/hooks/use-api-query";
import { useLocale } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n-utils";
import { EllipsisIcon, FileTextIcon, GaugeIcon, Globe2Icon, RocketIcon, SettingsIcon, ShieldCheckIcon, type LucideIcon } from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

export const navItems: NavItem[] = [
  { title: "common:nav.dashboard", href: "/dashboard", icon: GaugeIcon },
  { title: "common:nav.domains", href: "/domains", icon: Globe2Icon },
  { title: "common:nav.certificates", href: "/certificates", icon: ShieldCheckIcon },
  { title: "common:nav.deployments", href: "/deployments", icon: RocketIcon },
  { title: "common:nav.logs", href: "/logs", icon: FileTextIcon },
  { title: "common:nav.settings", href: "/settings/general", icon: SettingsIcon },
];

// `useRouter().pathname` returns the route pattern (e.g. "/[locale]/dashboard"),
// while navItems hrefs are stored without the locale prefix. Strip the leading
// "/[locale]" segment so active-state comparison keeps working post-localization.
function isActive(pathname: string, href: string) {
  const current = pathname.replace(/\/$/, "");
  const target = href.replace(/\/$/, "");
  return current === target || (target !== "/" && current.startsWith(`${target}/`));
}

function NavButton({ item, active }: { item: NavItem; active: boolean }) {
  const { state } = useSidebar();
  const { t } = useTranslation(["common"]);
  const collapsed = state === "collapsed";
  const Icon = item.icon;
  return (
    <LocalizedLink
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
      <span className={cn("truncate", collapsed && "max-w-full")}>{t(item.title)}</span>
    </LocalizedLink>
  );
}

export function Sidebar() {
  const router = useRouter();
  const { t } = useTranslation(["common"]);
  const dashboard = useApiQuery(getDashboard);
  const pathname = router.pathname.replace(/^\/\[locale\]/, "");
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const nginxStatus = dashboard.data?.nginx.status
    ?? (dashboard.error ? t("common:nav.nginxStatus.unavailable") : t("common:nav.nginxStatus.checking"));
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
          {t("common:nav.brand")}
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
        <div className={cn("mb-2 text-muted-foreground", collapsed ? "text-center text-[10px]" : "px-2 text-xs")}>
          {collapsed ? "N/A" : `${t("common:nav.nginxStatus.label")}: ${nginxStatus}`}
        </div>
        <SidebarTrigger className="w-full rounded-md py-2 hover:bg-sidebar-accent" />
      </SidebarFooter>
    </SidebarPrimitive>
  );
}

export function Tabbar() {
  const router = useRouter();
  const locale = useLocale();
  const { t } = useTranslation(["common"]);
  const pathname = router.pathname.replace(/^\/\[locale\]/, "");
  const primaryItems = navItems.filter((item) => ["/dashboard", "/domains", "/logs"].includes(item.href));
  const moreItems = navItems.filter((item) => !primaryItems.includes(item));
  const moreActive = moreItems.some((item) => isActive(pathname, item.href));

  return (
    <nav
      aria-label="Primary"
      className="relative z-50 flex shrink-0 select-none items-stretch border-t border-border bg-background/95 backdrop-blur [touch-action:manipulation] md:hidden pb-[env(safe-area-inset-bottom)]"
    >
      {primaryItems.map((item) => {
        const Icon = item.icon;
        const isActiveItem = isActive(pathname, item.href);
        return (
          <LocalizedLink
            key={item.href}
            href={item.href}
            aria-current={isActiveItem ? "page" : undefined}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" || isActiveItem) return;

              event.preventDefault();
              void router.push(localizePath(item.href, locale));
            }}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2 transition-colors",
              isActiveItem
                ? "text-primary"
                : "text-muted-foreground/60 hover:text-foreground",
            )}
          >
            <Icon className="size-5" />
            <span className="text-[10px] leading-none">{t(item.title)}</span>
          </LocalizedLink>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2 transition-colors",
              moreActive ? "text-primary" : "text-muted-foreground/60 hover:text-foreground",
            )}
          >
            <EllipsisIcon className="size-5" />
            <span className="text-[10px] leading-none">{t("common:nav.more")}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="mb-2 min-w-48">
          {moreItems.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuItem asChild key={item.href}>
                <LocalizedLink href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
                  <Icon />
                  {t(item.title)}
                </LocalizedLink>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
