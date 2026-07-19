import { useRouter } from "next/router";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { LogViewer } from "@/components/pages/logs/log-viewer";
import { DomainTabs } from "./domain-tabs";

export function DomainLogs() {
  const router = useRouter();
  const domainId = decodeURIComponent(router.asPath.match(/^\/domains\/([^/?]+)\/logs/)?.[1] ?? "");
  if (!router.isReady || !domainId) return <Skeleton className="m-8 h-96" />;
  return <><PageHeader title="Domain Logs" description="查看当前 Domain 最近的结构化 access/error 日志。" breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Domains", href: "/domains" }, { label: "Logs" }]} /><DomainTabs domainId={domainId} active="logs" /><div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8"><LogViewer domainId={domainId} /></div></>;
}
