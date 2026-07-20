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
import { useLocale } from "@/hooks/use-locale";
import { formatErrorMessage } from "@/lib/i18n-error";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(["common", "dashboard"]);
  const locale = useLocale();
  const query = useApiQuery(getDashboard);
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <PageHeader
        title={t("dashboard:title")}
        description={
          query.data
            ? t("dashboard:lastRefreshed", { time: dateFormatter.format(query.data.refreshedAt) })
            : t("dashboard:description")
        }
        action={
          <Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}>
            <RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />
            {t("dashboard:refresh")}
          </Button>
        }
      />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 py-6 md:px-8">
        {query.error ? (
          <Alert variant="destructive">
            <AlertTitle>{t("dashboard:loadFailed")}</AlertTitle>
            <AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription>
          </Alert>
        ) : null}

        {query.data?.runtime.status === "degraded" ? (
          <Alert variant="destructive">
            <AlertTitle>{t("dashboard:degraded.title")}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              {t("dashboard:degraded.description")}
              <Button asChild size="sm" variant="outline"><LocalizedLink href="/settings/diagnostics">{t("dashboard:degraded.openDiagnostics")}</LocalizedLink></Button>
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
            <section aria-label={t("dashboard:summary")} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title={t("dashboard:metrics.domains.title")}
                description={t("dashboard:metrics.domains.description", { count: query.data.domains.enabled })}
                value={String(query.data.domains.total)}
                icon={Globe2Icon}
                href="/domains"
              />
              <MetricCard
                title={t("dashboard:metrics.certificates.title")}
                description={t("dashboard:metrics.certificates.description", { expiring: query.data.certificates.expiring, renewing: query.data.certificates.renewing })}
                value={String(query.data.certificates.active)}
                icon={ShieldCheckIcon}
                href="/certificates"
              />
              <MetricCard
                title={t("dashboard:metrics.nginx.title")}
                description={query.data.nginx.version ?? t("dashboard:metrics.nginx.waitingRuntime")}
                value={query.data.nginx.status}
                icon={ServerIcon}
              />
              <MetricCard
                title={t("dashboard:metrics.lastDeployment.title")}
                description={
                  query.data.lastDeployment
                    ? dateFormatter.format(query.data.lastDeployment.createdAt)
                    : t("dashboard:metrics.lastDeployment.none")
                }
                value={query.data.lastDeployment?.status ?? t("dashboard:metrics.lastDeployment.noneValue")}
                icon={ActivityIcon}
                href="/deployments"
              />
            </section>

            <section className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <Card className="border border-border">
                <CardHeader>
                  <CardTitle>{t("dashboard:attention.title")}</CardTitle>
                  <CardDescription>{t("dashboard:attention.description")}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-border pb-3">
                    <span className="text-sm text-muted-foreground">{t("dashboard:attention.drafts")}</span>
                    <span className="font-mono text-base">{query.data.domains.drafts}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border pb-3">
                    <span className="text-sm text-muted-foreground">{t("dashboard:attention.failedDomains")}</span>
                    <span className="font-mono text-base">{query.data.domains.failed}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{t("dashboard:attention.certificateIssues")}</span>
                    <span className="font-mono text-base">
                      {query.data.certificates.expiring + query.data.certificates.failed + query.data.certificates.waitingManual}
                    </span>
                  </div>
                  {query.data.certificates.waitingManual ? <Alert><AlertTitle>{t("dashboard:attention.manualDns.title")}</AlertTitle><AlertDescription className="flex flex-col items-start gap-2"><span>{t("dashboard:attention.manualDns.description", { count: query.data.certificates.waitingManual })}</span>{query.data.renewalAttention.map((item) => <Button asChild size="sm" variant="outline" key={item.orderId}><LocalizedLink href={`/domains/ssl?id=${item.domainId}&orderId=${item.orderId}`}>{item.hostname}</LocalizedLink></Button>)}</AlertDescription></Alert> : null}
                </CardContent>
              </Card>

              <Card className="border border-border">
                <CardHeader>
                  <CardTitle>{t("dashboard:recentActivity.title")}</CardTitle>
                  <CardDescription>{t("dashboard:recentActivity.description")}</CardDescription>
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
                    <p className="py-6 text-center text-sm text-muted-foreground">{t("dashboard:recentActivity.empty")}</p>
                  )}
                </CardContent>
              </Card>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{t("dashboard:recentDomains.title")}</h2>
                  <p className="text-sm text-muted-foreground">{t("dashboard:recentDomains.description")}</p>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <LocalizedLink href="/domains">
                    {t("dashboard:recentDomains.viewAll")}
                    <ArrowRightIcon data-icon="inline-end" />
                  </LocalizedLink>
                </Button>
              </div>
              {query.data.recentDomains.length ? (
                <div className="overflow-hidden rounded-md border border-border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("dashboard:recentDomains.columns.domain")}</TableHead>
                        <TableHead>{t("dashboard:recentDomains.columns.runtimeStatus")}</TableHead>
                        <TableHead>{t("dashboard:recentDomains.columns.activeVersion")}</TableHead>
                        <TableHead>{t("dashboard:recentDomains.columns.lastModified")}</TableHead>
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
                            {domain.activeVersionId ? domain.activeVersionId.slice(0, 8) : t("dashboard:recentDomains.notPublished")}
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
                    <EmptyTitle>{t("dashboard:recentDomains.empty.title")}</EmptyTitle>
                    <EmptyDescription>{t("dashboard:recentDomains.empty.description")}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button asChild>
                      <LocalizedLink href="/domains/create">{t("dashboard:recentDomains.empty.createFirst")}</LocalizedLink>
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
