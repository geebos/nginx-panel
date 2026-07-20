import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/router";
import {
  CheckCircle2Icon,
  Globe2Icon,
  HistoryIcon,
  NetworkIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DomainPageActions } from "@/components/pages/domains/page-actions";
import { DomainTabs } from "@/components/pages/domains/tabs";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { getDomain } from "@/lib/api";
import { useApiQuery } from "@/hooks/use-api-query";
import { useLocale } from "@/hooks/use-locale";
import { formatErrorMessage } from "@/lib/i18n/error";

function DomainOverview({ domainId, created }: { domainId: string; created: boolean }) {
  const { t } = useTranslation(["common", "domains"]);
  const locale = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const load = React.useCallback(() => getDomain(domainId), [domainId]);
  const query = useApiQuery(load);

  const domain = query.data?.domain;
  const config = query.data?.config;
  const data = query.data;
  return (
    <>
      <PageHeader
        title={
          domain ? (
            <span className="flex flex-wrap items-center gap-3">
              {domain.primaryHostname}
              <StatusBadge status={domain.enabled ? domain.runtimeStatus : "disabled"} />
            </span>
          ) : (
            t("domains:overview.titleFallback")
          )
        }
        description={
          domain
            ? `${query.data?.activeVersion ? `v${query.data.activeVersion.versionNumber} ${t("domains:overview.activeSuffix")}` : t("domains:overview.notPublished")}，${query.data?.draftVersion ? `v${query.data.draftVersion.versionNumber} ${t("domains:overview.draftSuffix")}` : t("domains:overview.noDraft")}`
            : t("domains:overview.descriptionFallback")
        }
        breadcrumbs={[
          { label: t("domains:common.breadcrumbs.domains"), href: "/domains" },
          { label: domain?.primaryHostname ?? t("domains:overview.breadcrumbFallback") },
        ]}
        action={
          <>
            <Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}>
              <RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />
              {t("domains:common.actions.refresh")}
            </Button>
            <DomainPageActions domainId={domainId} data={data} />
          </>
        }
      />
      <DomainTabs domainId={domainId} active="overview" />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8">
        {created ? (
          <Alert>
            <CheckCreatedIcon />
            <AlertTitle>{t("domains:overview.createdAlertTitle")}</AlertTitle>
            <AlertDescription>{t("domains:overview.createdAlertDescription")}</AlertDescription>
          </Alert>
        ) : null}

        {query.error ? (
          <Alert variant="destructive">
            <AlertTitle>{t("domains:overview.loadFailed")}</AlertTitle>
            <AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription>
          </Alert>
        ) : null}

        {query.loading && !query.data ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton className="h-52" key={index} />
            ))}
          </div>
        ) : domain && config && data ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border border-border">
              <CardHeader>
                <CardTitle>{t("domains:overview.runtimeCard.title")}</CardTitle>
                <CardDescription>{t("domains:overview.runtimeCard.description")}</CardDescription>
                <CardAction><Globe2Icon className="size-4 text-muted-foreground" /></CardAction>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">{t("domains:overview.runtimeCard.nginxStatus")}</p>
                  <div className="mt-1"><StatusBadge status={domain.enabled ? domain.runtimeStatus : "disabled"} /></div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("domains:overview.runtimeCard.activeVersion")}</p>
                  <p className="mt-1 font-mono text-sm">
                    {data.activeVersion ? `v${data.activeVersion.versionNumber}` : t("domains:overview.runtimeCard.notPublished")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("domains:overview.runtimeCard.lastDeployment")}</p>
                  <p className="mt-1 text-sm">
                    {data.recentDeployments[0]
                      ? dateFormatter.format(data.recentDeployments[0].createdAt)
                      : t("domains:overview.runtimeCard.none")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("domains:overview.runtimeCard.configValidation")}</p>
                  <p className="mt-1 text-sm">{t("domains:overview.runtimeCard.notTested")}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border">
              <CardHeader>
                <CardTitle>{t("domains:overview.infoCard.title")}</CardTitle>
                <CardDescription>{t("domains:overview.infoCard.description")}</CardDescription>
                <CardAction><NetworkIcon className="size-4 text-muted-foreground" /></CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">{t("domains:overview.infoCard.primaryDomain")}</p>
                  <p className="mt-1 font-medium">{domain.primaryHostname}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("domains:overview.infoCard.aliases")}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {domain.aliases.length ? domain.aliases.map((alias) => <Badge variant="secondary" key={alias}>{alias}</Badge>) : <span className="text-sm text-muted-foreground">{t("domains:common.status.none")}</span>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><p className="text-xs text-muted-foreground">{t("domains:overview.infoCard.created")}</p><p className="mt-1 text-sm">{dateFormatter.format(domain.createdAt)}</p></div>
                  <div><p className="text-xs text-muted-foreground">{t("domains:overview.infoCard.enabled")}</p><p className="mt-1 text-sm">{domain.enabled ? t("domains:common.status.yes") : t("domains:common.status.no")}</p></div>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border">
              <CardHeader>
                <CardTitle>{t("domains:overview.draftCard.title")}</CardTitle>
                <CardDescription>{t("domains:overview.draftCard.description")}</CardDescription>
                <CardAction><HistoryIcon className="size-4 text-muted-foreground" /></CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {data.draftVersion ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono text-lg">v{data.draftVersion.versionNumber}</p>
                        <p className="text-sm text-muted-foreground">{data.draftVersion.changeSummary}</p>
                      </div>
                      <StatusBadge status="draft" />
                    </div>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      {t("domains:overview.draftCard.shaLabel")} {data.draftVersion.snapshotChecksum}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("domains:overview.draftCard.synced")}</p>
                )}
              </CardContent>
            </Card>

            <Card className="border border-border">
              <CardHeader>
                <CardTitle>{t("domains:overview.routesCard.title")}</CardTitle>
                <CardDescription>{t("domains:overview.routesCard.description", { count: config.routes.length })}</CardDescription>
                <CardAction><NetworkIcon className="size-4 text-muted-foreground" /></CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {config.routes.length ? config.routes.slice(0, 3).map((route) => (
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0" key={route.id}>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">{route.path}</p>
                      <p className="truncate text-xs text-muted-foreground">{route.type}</p>
                    </div>
                    <Badge variant={route.enabled ? "outline" : "secondary"}>{route.enabled ? t("domains:common.status.enabled") : t("domains:common.status.disabled")}</Badge>
                  </div>
                )) : <p className="text-sm text-muted-foreground">{t("domains:overview.routesCard.empty")}</p>}
              </CardContent>
            </Card>

            <Card className="border border-border lg:col-span-2">
              <CardHeader>
                <CardTitle>{t("domains:overview.httpsCard.title")}</CardTitle>
                <CardDescription>{t("domains:overview.httpsCard.description")}</CardDescription>
                <CardAction><ShieldCheckIcon className="size-4 text-muted-foreground" /></CardAction>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">{t("domains:overview.httpsCard.status")}</p><div className="mt-1"><StatusBadge status={config.ssl.certificateId ? "active" : config.ssl.enabled ? "draft" : "disabled"} /></div></div>
                <div><p className="text-xs text-muted-foreground">{t("domains:overview.httpsCard.environment")}</p><p className="mt-1 text-sm capitalize">{config.ssl.environment}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("domains:overview.httpsCard.autoRenew")}</p><p className="mt-1 text-sm">{config.ssl.autoRenew ? t("domains:common.status.enabled") : t("domains:common.status.disabled")}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("domains:overview.httpsCard.forceHttps")}</p><p className="mt-1 text-sm">{config.ssl.forceHttps ? t("domains:common.status.enabled") : t("domains:common.status.disabled")}</p></div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}

function CheckCreatedIcon() {
  return <CheckCircle2Icon aria-hidden="true" />;
}

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "domains"]);

export default function DomainOverviewPage() {
  const router = useRouter();
  const domainId = typeof router.query.id === "string" ? router.query.id : "";
  const created = router.query.created === "1";
  if (!router.isReady || !domainId) return <Page className="px-0 pb-16"><Skeleton className="m-8 h-96" /></Page>;
  return <Page className="px-0 pb-16"><DomainOverview domainId={domainId} created={created} /></Page>;
}
