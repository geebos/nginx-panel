import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import { useTranslation } from "react-i18next";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { RefreshCwIcon, RocketIcon } from "lucide-react";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { useApiQuery } from "@/hooks/use-api-query";
import { useLocale } from "@/hooks/use-locale";
import { getDeployments } from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n-error";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "deployments"]);

export default function DeploymentsPage() {
  const { t } = useTranslation(["common", "deployments"]);
  const locale = useLocale();
  const query = useApiQuery(getDeployments);
  const dateFormatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <Page className="px-0 pb-16">
      <PageHeader
        title={t("deployments:title")}
        description={t("deployments:description")}
        breadcrumbs={[{ label: t("deployments:title") }]}
        action={<Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}><RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />{t("deployments:refresh")}</Button>}
      />
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>{t("deployments:loadFailed")}</AlertTitle><AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-80" /> : query.data?.items.length ? (
          <div className="rounded-md border border-border bg-card">
            <Table><TableHeader><TableRow><TableHead>{t("deployments:columns.id")}</TableHead><TableHead>{t("deployments:columns.type")}</TableHead><TableHead>{t("deployments:columns.status")}</TableHead><TableHead>{t("deployments:columns.domain")}</TableHead><TableHead>{t("deployments:columns.started")}</TableHead><TableHead>{t("deployments:columns.duration")}</TableHead></TableRow></TableHeader><TableBody>
              {query.data.items.map((item) => (
                <TableRow key={item.id}><TableCell><LocalizedLink className="font-mono text-xs underline-offset-4 hover:underline" href={`/deployments/detail?id=${item.id}`}>{item.id.slice(0, 8)}</LocalizedLink></TableCell><TableCell className="capitalize">{item.type}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell className="font-mono text-xs">{item.domainId?.slice(0, 8) ?? t("deployments:globalDomain")}</TableCell><TableCell>{dateFormatter.format(item.startedAt ?? item.createdAt)}</TableCell><TableCell>{item.startedAt && item.finishedAt ? `${item.finishedAt - item.startedAt} ms` : "-"}</TableCell></TableRow>
              ))}
            </TableBody></Table>
          </div>
        ) : (
          <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><RocketIcon /></EmptyMedia><EmptyTitle>{t("deployments:empty.title")}</EmptyTitle><EmptyDescription>{t("deployments:empty.description")}</EmptyDescription></EmptyHeader></Empty>
        )}
      </div>
    </Page>
  );
}
