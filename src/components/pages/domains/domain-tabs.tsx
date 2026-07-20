import { LocalizedLink } from "@/components/i18n/localized-link";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Overview", slug: "overview", enabled: true },
  { label: "Routes", slug: "routes", enabled: true },
  { label: "SSL", slug: "ssl", enabled: true },
  { label: "Headers", slug: "headers", enabled: true },
  { label: "Advanced", slug: "advanced", enabled: true },
  { label: "Logs", slug: "logs", enabled: true },
  { label: "History", slug: "history", enabled: true },
];

export function DomainTabs({ domainId, active }: { domainId: string; active: string }) {
  return (
    <div className="border-b border-border bg-background px-4 md:px-8">
      <nav className="mx-auto flex w-full max-w-[1440px] gap-1 overflow-x-auto" aria-label="Domain sections">
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
              {tab.label}
            </LocalizedLink>
          ) : (
            <span
              aria-disabled="true"
              className="shrink-0 cursor-not-allowed border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted-foreground/60"
              key={tab.slug}
              title="后续阶段接入"
            >
              {tab.label}
            </span>
          ),
        )}
      </nav>
    </div>
  );
}
