import * as React from "react";

import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

export function Page({
  className,
  children,
  header,
  onRefresh,
  ...props
}: React.ComponentProps<"div"> & {
  header?: React.ReactNode;
  onRefresh?: () => Promise<void>;
}) {
  const isMobile = useIsMobile();

  header = header || (
    <div
      data-slot="page-safe-area-placeholder"
      aria-hidden="true"
      className="pointer-events-none h-[env(safe-area-inset-top)] shrink-0 bg-transparent"
    />
  );

  const page = (
    <div
      data-slot="page"
      className={cn(
        "flex flex-1 flex-col bg-secondary px-4 pb-16",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );

  const body =
    isMobile && onRefresh ? (
      <PullToRefresh className="bg-secondary" onRefresh={onRefresh}>
        {page}
      </PullToRefresh>
    ) : (
      page
    );

  return (
    <>
      {header}
      {body}
    </>
  );
}
