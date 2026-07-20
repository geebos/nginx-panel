import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import * as React from "react";
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
import { DomainPageActions } from "@/components/pages/domains/domain-page-actions";
import { DomainTabs } from "@/components/pages/domains/domain-tabs";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { getDomain } from "@/lib/api";
import { useApiQuery } from "@/hooks/use-api-query";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function DomainOverview({ domainId, created }: { domainId: string; created: boolean }) {
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
            "Domain Overview"
          )
        }
        description={
          domain
            ? `${query.data?.activeVersion ? `v${query.data.activeVersion.versionNumber} Active` : "尚未发布"}，${query.data?.draftVersion ? `v${query.data.draftVersion.versionNumber} Draft` : "无草稿"}`
            : "读取域名概览。"
        }
        breadcrumbs={[
          { label: "Domains", href: "/domains" },
          { label: domain?.primaryHostname ?? "Overview" },
        ]}
        action={
          <>
            <Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}>
              <RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />
              刷新
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
            <AlertTitle>v1 草稿已创建</AlertTitle>
            <AlertDescription>线上 Nginx 尚未改变。可先测试草稿，安全发布将在 runtime image spike 完成后接入。</AlertDescription>
          </Alert>
        ) : null}

        {query.error ? (
          <Alert variant="destructive">
            <AlertTitle>域名概览加载失败</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
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
                <CardTitle>运行概况</CardTitle>
                <CardDescription>当前线上版本和最近运行状态。</CardDescription>
                <CardAction><Globe2Icon className="size-4 text-muted-foreground" /></CardAction>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Nginx status</p>
                  <div className="mt-1"><StatusBadge status={domain.enabled ? domain.runtimeStatus : "disabled"} /></div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Active version</p>
                  <p className="mt-1 font-mono text-sm">
                    {data.activeVersion ? `v${data.activeVersion.versionNumber}` : "Not published"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last deployment</p>
                  <p className="mt-1 text-sm">
                    {data.recentDeployments[0]
                      ? dateFormatter.format(data.recentDeployments[0].createdAt)
                      : "None"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Config validation</p>
                  <p className="mt-1 text-sm">Not tested</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border">
              <CardHeader>
                <CardTitle>域名信息</CardTitle>
                <CardDescription>主域名、别名和运行投影。</CardDescription>
                <CardAction><NetworkIcon className="size-4 text-muted-foreground" /></CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Primary Domain</p>
                  <p className="mt-1 font-medium">{domain.primaryHostname}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Aliases</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {domain.aliases.length ? domain.aliases.map((alias) => <Badge variant="secondary" key={alias}>{alias}</Badge>) : <span className="text-sm text-muted-foreground">None</span>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><p className="text-xs text-muted-foreground">Created</p><p className="mt-1 text-sm">{dateFormatter.format(domain.createdAt)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Enabled</p><p className="mt-1 text-sm">{domain.enabled ? "Yes" : "No"}</p></div>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border">
              <CardHeader>
                <CardTitle>草稿变更</CardTitle>
                <CardDescription>当前草稿可继续编辑，发布后冻结为不可变版本。</CardDescription>
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
                      SHA-256 {data.draftVersion.snapshotChecksum}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">线上配置已同步。</p>
                )}
              </CardContent>
            </Card>

            <Card className="border border-border">
              <CardHeader>
                <CardTitle>路由摘要</CardTitle>
                <CardDescription>{config.routes.length} 条路由，按 Nginx 最长前缀匹配。</CardDescription>
                <CardAction><NetworkIcon className="size-4 text-muted-foreground" /></CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {config.routes.length ? config.routes.slice(0, 3).map((route) => (
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0" key={route.id}>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">{route.path}</p>
                      <p className="truncate text-xs text-muted-foreground">{route.type}</p>
                    </div>
                    <Badge variant={route.enabled ? "outline" : "secondary"}>{route.enabled ? "Enabled" : "Disabled"}</Badge>
                  </div>
                )) : <p className="text-sm text-muted-foreground">尚未添加路由，发布后非 ACME 请求将返回 404。</p>}
              </CardContent>
            </Card>

            <Card className="border border-border lg:col-span-2">
              <CardHeader>
                <CardTitle>HTTPS</CardTitle>
                <CardDescription>证书申请是独立流程，不由发布按钮隐式触发。</CardDescription>
                <CardAction><ShieldCheckIcon className="size-4 text-muted-foreground" /></CardAction>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">Status</p><div className="mt-1"><StatusBadge status={config.ssl.certificateId ? "active" : config.ssl.enabled ? "draft" : "disabled"} /></div></div>
                <div><p className="text-xs text-muted-foreground">Environment</p><p className="mt-1 text-sm capitalize">{config.ssl.environment}</p></div>
                <div><p className="text-xs text-muted-foreground">Auto renew</p><p className="mt-1 text-sm">{config.ssl.autoRenew ? "Enabled" : "Disabled"}</p></div>
                <div><p className="text-xs text-muted-foreground">Force HTTPS</p><p className="mt-1 text-sm">{config.ssl.forceHttps ? "Enabled" : "Disabled"}</p></div>
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
export const getStaticProps = makeStaticProps(["common"]);

export default function DomainOverviewPage() {
  const router = useRouter();
  const domainId = typeof router.query.id === "string" ? router.query.id : "";
  const created = router.query.created === "1";
  if (!router.isReady || !domainId) return <Page className="px-0 pb-16"><Skeleton className="m-8 h-96" /></Page>;
  return <Page className="px-0 pb-16"><DomainOverview domainId={domainId} created={created} /></Page>;
}
