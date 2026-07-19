import * as React from "react";
import { useRouter } from "next/router";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { LogViewer } from "@/components/pages/logs/log-viewer";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { DomainTabs } from "./domain-tabs";
import { useApiQuery } from "@/hooks/use-api-query";
import { getDomain } from "@/lib/api";

export function DomainLogs() {
  const router = useRouter();
  const domainId = decodeURIComponent(router.asPath.match(/^\/domains\/([^/?]+)\/logs/)?.[1] ?? "");
  const load = React.useCallback(() => getDomain(domainId), [domainId]);
  const query = useApiQuery(load);
  if (!router.isReady || !domainId) return <Skeleton className="m-8 h-96" />;
  const hostname = query.data?.domain.primaryHostname ?? "Domain";
  return <><PageHeader title={query.data ? <span className="flex flex-wrap items-center gap-3">{query.data.domain.primaryHostname}<StatusBadge status={query.data.domain.enabled ? query.data.domain.runtimeStatus : "disabled"} /></span> : "Logs"} description="查看当前 Domain 最近的结构化 access/error 日志。" breadcrumbs={[{ label: "Domains", href: "/domains" }, { label: hostname, href: `/domains/${domainId}/overview` }, { label: "Logs" }]} /><DomainTabs domainId={domainId} active="logs" /><div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8"><LogViewer domainId={domainId} /></div></>;
}
