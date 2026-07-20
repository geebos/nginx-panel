import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { useRouter } from "next/router";
import { ArrowLeftIcon } from "lucide-react";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TextDiff } from "@/components/pages/shared/text-diff";
import { useApiQuery } from "@/hooks/use-api-query";
import { getDomain, getDomainVersion, getDomainVersionDiff } from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n-error";

type VersionPageData =
  | Awaited<ReturnType<typeof getDomainVersion>>
  | Awaited<ReturnType<typeof getDomainVersionDiff>>;

function CodePanel({ value }: { value: string }) {
  return <pre className="max-h-[60dvh] overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs whitespace-pre">{value}</pre>;
}

function DomainVersion({ domainId, versionId, base }: { domainId: string; versionId: string; base: string }) {
  const { t } = useTranslation(["common", "domains"]);
  const isDiff = Boolean(base);
  const load = React.useCallback(async (): Promise<VersionPageData> => isDiff ? getDomainVersionDiff(domainId, versionId, base) : getDomainVersion(domainId, versionId), [base, isDiff, domainId, versionId]);
  const query = useApiQuery<VersionPageData>(load);
  const domainLoad = React.useCallback(() => getDomain(domainId), [domainId]);
  const domainQuery = useApiQuery(domainLoad);
  const diff = isDiff && query.data && "changes" in query.data ? query.data : null;
  const detail = !isDiff && query.data && "nginxPreview" in query.data ? query.data : null;
  return (
    <>
      <PageHeader
        title={diff ? t("domains:version.compareTitle", { base: diff.base.versionNumber, target: diff.target.versionNumber }) : detail ? t("domains:version.versionTitle", { n: detail.version.versionNumber }) : t("domains:version.titleFallback")}
        description={diff ? t("domains:version.descriptionDiff", { count: diff.changes.length }) : detail ? (detail.version.status === "draft" ? t("domains:version.descriptionDetailDraft", { summary: detail.version.changeSummary }) : t("domains:version.descriptionDetailImmutable", { summary: detail.version.changeSummary })) : t("domains:version.descriptionFallback")}
        breadcrumbs={[{ label: t("domains:common.breadcrumbs.domains"), href: "/domains" }, { label: domainQuery.data?.domain.primaryHostname ?? t("domains:common.breadcrumbs.domain"), href: `/domains/overview?id=${domainId}` }, { label: t("domains:common.breadcrumbs.history"), href: `/domains/history?id=${domainId}` }, { label: isDiff ? t("domains:version.breadcrumbDiff") : t("domains:version.breadcrumbVersion") }]}
        action={<Button size="sm" variant="outline" asChild><LocalizedLink href={`/domains/history?id=${domainId}`}><ArrowLeftIcon data-icon="inline-start" />{t("domains:version.backToHistory")}</LocalizedLink></Button>}
      />
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>{t("domains:version.loadFailed")}</AlertTitle><AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-96" /> : detail ? (
          <Tabs defaultValue="nginx"><TabsList><TabsTrigger value="nginx">{t("domains:version.tabs.nginxPreview")}</TabsTrigger><TabsTrigger value="json">{t("domains:version.tabs.jsonSnapshot")}</TabsTrigger></TabsList><TabsContent value="nginx"><CodePanel value={detail.nginxPreview} /></TabsContent><TabsContent value="json"><CodePanel value={JSON.stringify(detail.config, null, 2)} /></TabsContent></Tabs>
        ) : diff ? (
          <>
            <Card className="border border-border"><CardHeader><CardTitle>{t("domains:version.changesCard.title")}</CardTitle><CardDescription>{t("domains:version.changesCard.description")}</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">{diff.changes.length ? diff.changes.map((change, index) => <div className="flex items-start gap-3 rounded-lg border border-border p-3" key={`${change.section}-${change.label}-${index}`}><Badge variant={change.kind === "removed" ? "destructive" : "outline"}>{change.kind}</Badge><div><p className="font-medium">{change.label}</p><p className="text-xs text-muted-foreground capitalize">{change.section}</p></div></div>) : <p className="text-sm text-muted-foreground">{t("domains:version.changesCard.empty")}</p>}</CardContent></Card>
            <Tabs defaultValue="nginx"><TabsList><TabsTrigger value="nginx">{t("domains:version.tabs.nginx")}</TabsTrigger><TabsTrigger value="json">{t("domains:version.tabs.json")}</TabsTrigger></TabsList><TabsContent value="nginx"><TextDiff oldText={diff.baseNginx} newText={diff.targetNginx} className="max-h-[60dvh]" /></TabsContent><TabsContent value="json"><div className="grid gap-4 lg:grid-cols-2"><CodePanel value={diff.baseJson} /><CodePanel value={diff.targetJson} /></div></TabsContent></Tabs>
          </>
        ) : null}
      </div>
    </>
  );
}

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "domains"]);

export default function DomainVersionPage() {
  const router = useRouter();
  const domainId = typeof router.query.id === "string" ? router.query.id : "";
  const versionId = typeof router.query.versionId === "string" ? router.query.versionId : "";
  const base = typeof router.query.base === "string" ? router.query.base : "";
  if (!router.isReady || !domainId || !versionId) return <Page className="px-0 pb-16"><Skeleton className="m-8 h-96" /></Page>;
  return <Page className="px-0 pb-16"><DomainVersion domainId={domainId} versionId={versionId} base={base} /></Page>;
}
