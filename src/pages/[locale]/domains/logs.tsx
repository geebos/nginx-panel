import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import * as React from "react";
import { useRouter } from "next/router";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { DomainTabs } from "@/components/pages/domains/domain-tabs";
import { LogViewer } from "@/components/pages/logs/log-viewer";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { useApiQuery } from "@/hooks/use-api-query";
import { getDomain } from "@/lib/api";

function DomainLogs({ domainId }: { domainId: string }) {
  const load = React.useCallback(() => getDomain(domainId), [domainId]);
  const query = useApiQuery(load);
  const hostname = query.data?.domain.primaryHostname ?? "Domain";
  return <><PageHeader title={query.data ? <span className="flex flex-wrap items-center gap-3">{query.data.domain.primaryHostname}<StatusBadge status={query.data.domain.enabled ? query.data.domain.runtimeStatus : "disabled"} /></span> : "Logs"} description="查看当前 Domain 最近的结构化 access/error 日志。" breadcrumbs={[{ label: "Domains", href: "/domains" }, { label: hostname, href: `/domains/overview?id=${domainId}` }, { label: "Logs" }]} /><DomainTabs domainId={domainId} active="logs" /><div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8"><LogViewer domainId={domainId} /></div></>;
}

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common"]);

export default function DomainLogsPage() {
  const router = useRouter();
  const domainId = typeof router.query.id === "string" ? router.query.id : "";
  if (!router.isReady || !domainId) return <Page className="px-0 pb-16"><Skeleton className="m-8 h-96" /></Page>;
  return <Page className="px-0 pb-16"><DomainLogs domainId={domainId} /></Page>;
}
