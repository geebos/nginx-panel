import * as React from "react";

import { cn } from "@/lib/utils";

// Section wrapper with an optional title/action row above the content.
function Section({
  title,
  action,
  className,
  children,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between px-3">
          {typeof title === "string" ? (
            <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          ) : (
            title
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export { Section };
