import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import * as React from "react";
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

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function DomainHistory({ domainId }: { domainId: string }) {
  const router = useRouter();
  const locale = useLocale();
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
        title={domain?.domain.primaryHostname ?? "History"}
        description="已发布版本不可变；当前 Draft 会原位更新，直到发布后冻结。"
        breadcrumbs={[{ label: "Domains", href: "/domains" }, { label: domain?.domain.primaryHostname ?? "Domain", href: `/domains/overview?id=${domainId}` }, { label: "History" }]}
        action={<Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}><RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />刷新</Button>}
      />
      <DomainTabs domainId={domainId} active="history" />
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>版本历史加载失败</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-80" /> : query.data?.versions.length ? (
          <div className="rounded-md border border-border bg-card"><Table><TableHeader><TableRow><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Summary</TableHead><TableHead>Created</TableHead><TableHead>Updated</TableHead><TableHead>Checksum</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
            {query.data.versions.map((version) => (
              <TableRow key={version.id}><TableCell className="font-mono">v{version.versionNumber}</TableCell><TableCell><StatusBadge status={version.id === domain?.activeVersion?.id ? "active" : version.status} /></TableCell><TableCell>{version.changeSummary}</TableCell><TableCell>{dateFormatter.format(version.createdAt)}</TableCell><TableCell>{dateFormatter.format(version.updatedAt)}</TableCell><TableCell className="max-w-40 truncate font-mono text-xs">{version.snapshotChecksum}</TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon-sm" variant="ghost" asChild><LocalizedLink href={`/domains/version?id=${domainId}&versionId=${version.id}`}><EyeIcon /><span className="sr-only">查看 v{version.versionNumber}</span></LocalizedLink></Button>{compareBase && compareBase !== version.id ? <><Button size="icon-sm" variant="ghost" asChild><LocalizedLink href={`/domains/version?id=${domainId}&versionId=${version.id}&base=${compareBase}`}><GitCompareArrowsIcon /><span className="sr-only">比较 v{version.versionNumber}</span></LocalizedLink></Button>{version.status !== "draft" && version.status !== "failed" ? <Button size="icon-sm" variant="ghost" onClick={() => { setRollbackTarget(version); setRollbackDiff(null); setRollbackError(""); void getDomainVersionDiff(domainId, version.id, compareBase).then((result) => setRollbackDiff(result)).catch((error: Error) => setRollbackError(error.message)); }}><RotateCcwIcon /><span className="sr-only">回滚到 v{version.versionNumber}</span></Button> : null}</> : null}</div></TableCell></TableRow>
            ))}
          </TableBody></Table></div>
        ) : <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><HistoryIcon /></EmptyMedia><EmptyTitle>没有配置版本</EmptyTitle><EmptyDescription>创建 Domain 后会生成可编辑草稿，发布后成为不可变版本。</EmptyDescription></EmptyHeader></Empty>}
      </div>
      <AlertDialog open={Boolean(rollbackTarget)} onOpenChange={(open) => { if (!open && !rollingBack) setRollbackTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>回滚到 v{rollbackTarget?.versionNumber}</AlertDialogTitle>
            <AlertDialogDescription>
              当前线上 v{domain?.activeVersion?.versionNumber} 将保持服务，直到新回滚版本通过完整配置测试并成功 reload。系统会复制目标快照创建一个新版本，不会修改历史记录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {rollbackError ? <p className="text-destructive">{rollbackError}</p> : rollbackDiff ? (<><p>检测到 {rollbackDiff.changes.length} 项语义变化。确认后将创建 v{(query.data?.versions[0]?.versionNumber ?? 0) + 1} 和回滚任务。</p><TextDiff oldText={rollbackDiff.baseNginx} newText={rollbackDiff.targetNginx} className="mt-3 max-h-[40dvh]" /></>) : <p className="flex items-center gap-2 text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" />正在计算与当前线上版本的差异…</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollingBack}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={rollingBack || !rollbackDiff || Boolean(rollbackError)} onClick={(event) => { event.preventDefault(); if (!rollbackTarget) return; setRollingBack(true); setRollbackError(""); void rollbackDomainVersion(domainId, rollbackTarget.id).then((result) => router.push(localizePath(`/deployments/detail?id=${result.deploymentId}`, locale))).catch((error: Error) => { setRollbackError(error.message); setRollingBack(false); }); }}>
              {rollingBack ? <LoaderCircleIcon className="animate-spin" /> : <RotateCcwIcon />}确认回滚
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common"]);

export default function DomainHistoryPage() {
  const router = useRouter();
  const domainId = typeof router.query.id === "string" ? router.query.id : "";
  if (!router.isReady || !domainId) return <Page className="px-0 pb-16"><Skeleton className="m-8 h-96" /></Page>;
  return <Page className="px-0 pb-16"><DomainHistory domainId={domainId} /></Page>;
}
