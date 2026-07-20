import { LocalizedLink } from "@/components/i18n/localized-link";
import {
  ActivityIcon,
  ArrowRightIcon,
  Globe2Icon,
  RefreshCwIcon,
  ServerIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { getDashboard } from "@/lib/api";
import { useApiQuery } from "@/hooks/use-api-query";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function MetricCard({
  title,
  description,
  value,
  icon: Icon,
  href,
}: {
  title: string;
  description: string;
  value: string;
  icon: typeof Globe2Icon;
  href?: string;
}) {
  const card = (
    <Card className="h-full border border-border">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-[28px] leading-none tracking-[-0.03em]">{value}</p>
      </CardContent>
    </Card>
  );

  return href ? (
    <LocalizedLink className="rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href={href}>
      {card}
    </LocalizedLink>
  ) : (
    card
  );
}

export function DashboardContent() {
  const query = useApiQuery(getDashboard);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          query.data
            ? `最后刷新 ${dateFormatter.format(query.data.refreshedAt)}`
            : "查看域名、证书和 Nginx 的当前状态。"
        }
        action={
          <Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}>
            <RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />
            刷新
          </Button>
        }
      />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 py-6 md:px-8">
        {query.error ? (
          <Alert variant="destructive">
            <AlertTitle>Dashboard 加载失败</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {query.data?.runtime.status === "degraded" ? (
          <Alert variant="destructive">
            <AlertTitle>运行配置处于 degraded 状态</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              普通发布与日志轮动已暂停，请检查一致性并按 SQLite 安全重建。
              <Button asChild size="sm" variant="outline"><LocalizedLink href="/settings/diagnostics">打开 Diagnostics</LocalizedLink></Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {query.loading && !query.data ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton className="h-32" key={index} />
            ))}
          </div>
        ) : query.data ? (
          <>
            <section aria-label="状态摘要" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="Domains"
                description={`${query.data.domains.enabled} 个已启用`}
                value={String(query.data.domains.total)}
                icon={Globe2Icon}
                href="/domains"
              />
              <MetricCard
                title="Certificates"
                description={`${query.data.certificates.expiring} 个即将过期 · ${query.data.certificates.renewing} 个续期中`}
                value={String(query.data.certificates.active)}
                icon={ShieldCheckIcon}
                href="/certificates"
              />
              <MetricCard
                title="Nginx"
                description={query.data.nginx.version ?? "等待运行时诊断"}
                value={query.data.nginx.status}
                icon={ServerIcon}
              />
              <MetricCard
                title="Last deployment"
                description={
                  query.data.lastDeployment
                    ? dateFormatter.format(query.data.lastDeployment.createdAt)
                    : "尚无发布记录"
                }
                value={query.data.lastDeployment?.status ?? "none"}
                icon={ActivityIcon}
                href="/deployments"
              />
            </section>

            <section className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <Card className="border border-border">
                <CardHeader>
                  <CardTitle>需要处理</CardTitle>
                  <CardDescription>草稿和失败状态集中在这里。</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-border pb-3">
                    <span className="text-sm text-muted-foreground">未发布草稿</span>
                    <span className="font-mono text-base">{query.data.domains.drafts}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border pb-3">
                    <span className="text-sm text-muted-foreground">失败域名</span>
                    <span className="font-mono text-base">{query.data.domains.failed}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">证书问题</span>
                    <span className="font-mono text-base">
                      {query.data.certificates.expiring + query.data.certificates.failed + query.data.certificates.waitingManual}
                    </span>
                  </div>
                  {query.data.certificates.waitingManual ? <Alert><AlertTitle>Manual DNS 续期等待处理</AlertTitle><AlertDescription className="flex flex-col items-start gap-2"><span>{query.data.certificates.waitingManual} 个续期订单正在等待 TXT 记录。</span>{query.data.renewalAttention.map((item) => <Button asChild size="sm" variant="outline" key={item.orderId}><LocalizedLink href={`/domains/ssl?id=${item.domainId}&orderId=${item.orderId}`}>{item.hostname}</LocalizedLink></Button>)}</AlertDescription></Alert> : null}
                </CardContent>
              </Card>

              <Card className="border border-border">
                <CardHeader>
                  <CardTitle>最近活动</CardTitle>
                  <CardDescription>最近创建的部署任务。</CardDescription>
                </CardHeader>
                <CardContent>
                  {query.data.recentDeployments.length ? (
                    <div className="flex flex-col">
                      {query.data.recentDeployments.map((deployment) => (
                        <LocalizedLink
                          className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0"
                          href={`/deployments/detail?id=${deployment.id}`}
                          key={deployment.id}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{deployment.type}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {dateFormatter.format(deployment.createdAt)}
                            </p>
                          </div>
                          <StatusBadge status={deployment.status} />
                        </LocalizedLink>
                      ))}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">尚无部署活动</p>
                  )}
                </CardContent>
              </Card>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">最近域名</h2>
                  <p className="text-sm text-muted-foreground">按最近修改时间排序。</p>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <LocalizedLink href="/domains">
                    查看全部
                    <ArrowRightIcon data-icon="inline-end" />
                  </LocalizedLink>
                </Button>
              </div>
              {query.data.recentDomains.length ? (
                <div className="overflow-hidden rounded-md border border-border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead>运行状态</TableHead>
                        <TableHead>当前版本</TableHead>
                        <TableHead>最后修改</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {query.data.recentDomains.map((domain) => (
                        <TableRow key={domain.id}>
                          <TableCell>
                            <LocalizedLink className="font-medium hover:underline" href={`/domains/overview?id=${domain.id}`}>
                              {domain.primaryHostname}
                            </LocalizedLink>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={domain.enabled ? domain.runtimeStatus : "disabled"} />
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {domain.activeVersionId ? domain.activeVersionId.slice(0, 8) : "Not published"}
                          </TableCell>
                          <TableCell>{dateFormatter.format(domain.updatedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <Empty className="min-h-64 border border-border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Globe2Icon />
                    </EmptyMedia>
                    <EmptyTitle>还没有域名</EmptyTitle>
                    <EmptyDescription>创建第一个域名后，运行状态和发布记录会显示在这里。</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button asChild>
                      <LocalizedLink href="/domains/create">创建第一个域名</LocalizedLink>
                    </Button>
                  </EmptyContent>
                </Empty>
              )}
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
