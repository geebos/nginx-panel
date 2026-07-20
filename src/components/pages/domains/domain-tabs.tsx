import { useTranslation } from "react-i18next";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { cn } from "@/lib/utils";

const tabs = [
  { slug: "overview", enabled: true },
  { slug: "routes", enabled: true },
  { slug: "ssl", enabled: true },
  { slug: "headers", enabled: true },
  { slug: "advanced", enabled: true },
  { slug: "logs", enabled: true },
  { slug: "history", enabled: true },
] as const;

export function DomainTabs({ domainId, active }: { domainId: string; active: string }) {
  const { t } = useTranslation(["common", "domains"]);
  return (
    <div className="border-b border-border bg-background px-4 md:px-8">
      <nav className="mx-auto flex w-full max-w-[1440px] gap-1 overflow-x-auto" aria-label={t("domains:tabs.ariaLabel")}>
        {tabs.map((tab) =>
          tab.enabled ? (
            <LocalizedLink
              aria-current={tab.slug === active ? "page" : undefined}
              className={cn(
                "shrink-0 border-b-2 px-3 py-3 text-sm font-medium",
                tab.slug === active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              href={`/domains/${tab.slug}?id=${domainId}`}
              key={tab.slug}
            >
              {t(`domains:tabs.${tab.slug}`)}
            </LocalizedLink>
          ) : (
            <span
              aria-disabled="true"
              className="shrink-0 cursor-not-allowed border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted-foreground/60"
              key={tab.slug}
              title={t("domains:tabs.disabledTitle")}
            >
              {t(`domains:tabs.${tab.slug}`)}
            </span>
          ),
        )}
      </nav>
    </div>
  );
}
