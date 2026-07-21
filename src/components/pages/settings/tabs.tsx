import { useTranslation } from "react-i18next";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { cn } from "@/lib/utils";

const tabs = [
  { slug: "general" },
  { slug: "manager" },
  { slug: "nginx" },
  { slug: "security" },
  { slug: "cloudflare" },
  { slug: "logs" },
  { slug: "diagnostics" },
] as const;

export function SettingsTabs({ active }: { active: string }) {
  const { t } = useTranslation(["common"]);
  return (
    <div className="border-b border-border bg-background px-4 md:px-8">
      <nav
        className="mx-auto flex w-full max-w-[1440px] gap-1 overflow-x-auto"
        aria-label={t("common:settings.tabs.ariaLabel")}
      >
        {tabs.map((tab) => (
          <LocalizedLink
            aria-current={tab.slug === active ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-3 py-3 text-sm font-medium",
              tab.slug === active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            href={`/settings/${tab.slug}`}
            key={tab.slug}
          >
            {t(`common:settings.${tab.slug}.breadcrumb`)}
          </LocalizedLink>
        ))}
      </nav>
    </div>
  );
}
