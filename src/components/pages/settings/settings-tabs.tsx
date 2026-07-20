import Link from "next/link";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Nginx", slug: "nginx" },
  { label: "Security", slug: "security" },
  { label: "Cloudflare DNS", slug: "cloudflare" },
  { label: "Log Settings", slug: "logs" },
  { label: "Diagnostics", slug: "diagnostics" },
];

export function SettingsTabs({ active }: { active: string }) {
  return (
    <div className="border-b border-border bg-background px-4 md:px-8">
      <nav className="mx-auto flex w-full max-w-[1440px] gap-1 overflow-x-auto" aria-label="Settings sections">
        {tabs.map((tab) => (
          <Link
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
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
