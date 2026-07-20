import * as React from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { LocalizedLink } from "@/components/i18n/localized-link";

export type BreadcrumbEntry = { label: string; href?: string };

export function PageHeader({
  title,
  description,
  action,
  breadcrumbs,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  breadcrumbs?: BreadcrumbEntry[];
}) {
  return (
    <header className="border-b border-border bg-background px-4 py-5 md:px-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4">
        {breadcrumbs?.length ? (
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((entry, index) => (
                <React.Fragment key={`${entry.label}-${index}`}>
                  {index > 0 ? <BreadcrumbSeparator /> : null}
                  <BreadcrumbItem>
                    {entry.href ? (
                      <BreadcrumbLink asChild>
                        <LocalizedLink href={entry.href}>{entry.label}</LocalizedLink>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{entry.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        ) : null}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="font-heading text-[28px] font-normal tracking-[-0.02em] text-foreground">
              {title}
            </h1>
            {description ? (
              <p className="max-w-[65ch] text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      </div>
    </header>
  );
}
