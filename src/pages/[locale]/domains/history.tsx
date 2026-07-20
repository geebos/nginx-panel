import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { useRouter } from "next/router";
import { EyeIcon, GitCompareArrowsIcon, HistoryIcon, LoaderCircleIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DomainTabs } from "@/components/pages/domains/domain-tabs";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { TextDiff } from "@/components/pages/shared/text-diff";
import { useApiQuery } from "@/hooks/use-api-query";
import { useLocale } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n-utils";
import { getDomain, getDomainVersionDiff, getDomainVersions, rollbackDomainVersion, type ConfigVersionResponse } from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n-error";

function DomainHistory({ domainId }: { domainId: string }) {
  const { t } = useTranslation(["common", "domains"]);
  const router = useRouter();
  const locale = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const load = React.useCallback(async () => {
    const [domain, versions] = await Promise.all([getDomain(domainId), getDomainVersions(domainId)]);
    return { domain, versions: versions.items };
  }, [domainId]);
  const query = useApiQuery(load);
  const [rollbackTarget, setRollbackTarget] = React.useState<ConfigVersionResponse | null>(null);
  const [rollbackDiff, setRollbackDiff] = React.useState<Awaited<ReturnType<typeof getDomainVersionDiff>> | null>(null);
  const [rollbackError, setRollbackError] = React.useState("");
  const [rollingBack, setRollingBack] = React.useState(false);
  const domain = query.data?.domain;
  const compareBase = domain?.activeVersion?.id ?? query.data?.versions.at(-1)?.id;
  return (
    <>
      <PageHeader
        title={domain?.domain.primaryHostname ?? t("domains:history.titleFallback")}
        description={t("domains:history.description")}
        breadcrumbs={[{ label: t("domains:common.breadcrumbs.domains"), href: "/domains" }, { label: domain?.domain.primaryHostname ?? t("domains:common.breadcrumbs.domain"), href: `/domains/overview?id=${domainId}` }, { label: t("domains:common.breadcrumbs.history") }]}
        action={<Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}><RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />{t("domains:common.actions.refresh")}</Button>}
      />
      <DomainTabs domainId={domainId} active="history" />
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>{t("domains:history.loadFailed")}</AlertTitle><AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-80" /> : query.data?.versions.length ? (
          <div className="rounded-md border border-border bg-card"><Table><TableHeader><TableRow><TableHead>{t("domains:history.columns.version")}</TableHead><TableHead>{t("domains:history.columns.status")}</TableHead><TableHead>{t("domains:history.columns.summary")}</TableHead><TableHead>{t("domains:history.columns.created")}</TableHead><TableHead>{t("domains:history.columns.updated")}</TableHead><TableHead>{t("domains:history.columns.checksum")}</TableHead><TableHead className="text-right">{t("domains:history.columns.actions")}</TableHead></TableRow></TableHeader><TableBody>
            {query.data.versions.map((version) => (
              <TableRow key={version.id}><TableCell className="font-mono">v{version.versionNumber}</TableCell><TableCell><StatusBadge status={version.id === domain?.activeVersion?.id ? "active" : version.status} /></TableCell><TableCell>{version.changeSummary}</TableCell><TableCell>{dateFormatter.format(version.createdAt)}</TableCell><TableCell>{dateFormatter.format(version.updatedAt)}</TableCell><TableCell className="max-w-40 truncate font-mono text-xs">{version.snapshotChecksum}</TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon-sm" variant="ghost" asChild><LocalizedLink href={`/domains/version?id=${domainId}&versionId=${version.id}`}><EyeIcon /><span className="sr-only">{t("domains:history.srOnly.view", { n: version.versionNumber })}</span></LocalizedLink></Button>{compareBase && compareBase !== version.id ? <><Button size="icon-sm" variant="ghost" asChild><LocalizedLink href={`/domains/version?id=${domainId}&versionId=${version.id}&base=${compareBase}`}><GitCompareArrowsIcon /><span className="sr-only">{t("domains:history.srOnly.compare", { n: version.versionNumber })}</span></LocalizedLink></Button>{version.status !== "draft" && version.status !== "failed" ? <Button size="icon-sm" variant="ghost" onClick={() => { setRollbackTarget(version); setRollbackDiff(null); setRollbackError(""); void getDomainVersionDiff(domainId, version.id, compareBase).then((result) => setRollbackDiff(result)).catch((error: Error) => setRollbackError(formatErrorMessage(t, error))); }}><RotateCcwIcon /><span className="sr-only">{t("domains:history.srOnly.rollback", { n: version.versionNumber })}</span></Button> : null}</> : null}</div></TableCell></TableRow>
            ))}
          </TableBody></Table></div>
        ) : <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><HistoryIcon /></EmptyMedia><EmptyTitle>{t("domains:history.empty.title")}</EmptyTitle><EmptyDescription>{t("domains:history.empty.description")}</EmptyDescription></EmptyHeader></Empty>}
      </div>
      <AlertDialog open={Boolean(rollbackTarget)} onOpenChange={(open) => { if (!open && !rollingBack) setRollbackTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("domains:history.rollbackDialog.title", { n: rollbackTarget?.versionNumber ?? 0 })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("domains:history.rollbackDialog.description", { active: domain?.activeVersion?.versionNumber ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {rollbackError ? <p className="text-destructive">{rollbackError}</p> : rollbackDiff ? (<><p>{t("domains:history.rollbackDialog.diffDetected", { count: rollbackDiff.changes.length, next: (query.data?.versions[0]?.versionNumber ?? 0) + 1 })}</p><TextDiff oldText={rollbackDiff.baseNginx} newText={rollbackDiff.targetNginx} className="mt-3 max-h-[40dvh]" /></>) : <p className="flex items-center gap-2 text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" />{t("domains:history.rollbackDialog.diffLoading")}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollingBack}>{t("domains:common.actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={rollingBack || !rollbackDiff || Boolean(rollbackError)} onClick={(event) => { event.preventDefault(); if (!rollbackTarget) return; setRollingBack(true); setRollbackError(""); void rollbackDomainVersion(domainId, rollbackTarget.id).then((result) => router.push(localizePath(`/deployments/detail?id=${result.deploymentId}`, locale))).catch((error: Error) => { setRollbackError(formatErrorMessage(t, error)); setRollingBack(false); }); }}>
              {rollingBack ? <LoaderCircleIcon className="animate-spin" /> : <RotateCcwIcon />}{t("domains:history.rollbackDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "domains"]);

export default function DomainHistoryPage() {
  const router = useRouter();
  const domainId = typeof router.query.id === "string" ? router.query.id : "";
  if (!router.isReady || !domainId) return <Page className="px-0 pb-16"><Skeleton className="m-8 h-96" /></Page>;
  return <Page className="px-0 pb-16"><DomainHistory domainId={domainId} /></Page>;
}
