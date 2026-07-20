import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/router";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { DomainTabs } from "@/components/pages/domains/tabs";
import { LogViewer } from "@/components/pages/logs/viewer";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { useApiQuery } from "@/hooks/use-api-query";
import { getDomain } from "@/lib/api";

function DomainLogs({ domainId }: { domainId: string }) {
  const { t } = useTranslation(["common", "domains"]);
  const load = React.useCallback(() => getDomain(domainId), [domainId]);
  const query = useApiQuery(load);
  const hostname = query.data?.domain.primaryHostname ?? t("domains:common.breadcrumbs.domain");
  return <><PageHeader title={query.data ? <span className="flex flex-wrap items-center gap-3">{query.data.domain.primaryHostname}<StatusBadge status={query.data.domain.enabled ? query.data.domain.runtimeStatus : "disabled"} /></span> : t("domains:logs.titleFallback")} description={t("domains:logs.description")} breadcrumbs={[{ label: t("domains:common.breadcrumbs.domains"), href: "/domains" }, { label: hostname, href: `/domains/overview?id=${domainId}` }, { label: t("domains:common.breadcrumbs.logs") }]} /><DomainTabs domainId={domainId} active="logs" /><div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8"><LogViewer domainId={domainId} /></div></>;
}

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "domains", "logs"]);

export default function DomainLogsPage() {
  const router = useRouter();
  const domainId = typeof router.query.id === "string" ? router.query.id : "";
  if (!router.isReady || !domainId) return <Page className="px-0 pb-16"><Skeleton className="m-8 h-96" /></Page>;
  return <Page className="px-0 pb-16"><DomainLogs domainId={domainId} /></Page>;
}
