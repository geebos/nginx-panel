import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ArrowLeftIcon } from "lucide-react";
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

type VersionPageData =
  | Awaited<ReturnType<typeof getDomainVersion>>
  | Awaited<ReturnType<typeof getDomainVersionDiff>>;

function idsFromPath(asPath: string) {
  const match = asPath.match(/^\/domains\/([^/?]+)\/versions\/([^/?]+)(\/diff)?/);
  return { domainId: match?.[1] ? decodeURIComponent(match[1]) : "", versionId: match?.[2] ? decodeURIComponent(match[2]) : "", diff: Boolean(match?.[3]) };
}

function CodePanel({ value }: { value: string }) {
  return <pre className="max-h-[60dvh] overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs whitespace-pre">{value}</pre>;
}

export function DomainVersion() {
  const router = useRouter();
  const ids = idsFromPath(router.asPath);
  const baseId = typeof router.query.base === "string" ? router.query.base : "";
  const load = React.useCallback(async (): Promise<VersionPageData> => ids.diff ? getDomainVersionDiff(ids.domainId, ids.versionId, baseId) : getDomainVersion(ids.domainId, ids.versionId), [baseId, ids.diff, ids.domainId, ids.versionId]);
  const query = useApiQuery<VersionPageData>(load);
  const domainLoad = React.useCallback(() => getDomain(ids.domainId), [ids.domainId]);
  const domainQuery = useApiQuery(domainLoad);
  if (!router.isReady || !ids.domainId || !ids.versionId || (ids.diff && !baseId)) return <Skeleton className="m-8 h-96" />;
  const diff = ids.diff && query.data && "changes" in query.data ? query.data : null;
  const detail = !ids.diff && query.data && "nginxPreview" in query.data ? query.data : null;
  return (
    <>
      <PageHeader
        title={diff ? `Compare v${diff.base.versionNumber} and v${diff.target.versionNumber}` : detail ? `Version v${detail.version.versionNumber}` : "Version"}
        description={diff ? `${diff.changes.length} 项语义变化` : detail ? `${detail.version.changeSummary}。${detail.version.status === "draft" ? "当前草稿可继续编辑" : "该已发布快照不可变"}` : "读取配置快照。"}
        breadcrumbs={[{ label: "Domains", href: "/domains" }, { label: domainQuery.data?.domain.primaryHostname ?? "Domain", href: `/domains/${ids.domainId}/overview` }, { label: "History", href: `/domains/${ids.domainId}/history` }, { label: ids.diff ? "Diff" : "Version" }]}
        action={<Button size="sm" variant="outline" asChild><Link href={`/domains/${ids.domainId}/history`}><ArrowLeftIcon data-icon="inline-start" />返回历史</Link></Button>}
      />
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>版本加载失败</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-96" /> : detail ? (
          <Tabs defaultValue="nginx"><TabsList><TabsTrigger value="nginx">Nginx Preview</TabsTrigger><TabsTrigger value="json">JSON Snapshot</TabsTrigger></TabsList><TabsContent value="nginx"><CodePanel value={detail.nginxPreview} /></TabsContent><TabsContent value="json"><CodePanel value={JSON.stringify(detail.config, null, 2)} /></TabsContent></Tabs>
        ) : diff ? (
          <>
            <Card className="border border-border"><CardHeader><CardTitle>Semantic changes</CardTitle><CardDescription>按业务对象归类，不依赖文本行号。</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">{diff.changes.length ? diff.changes.map((change, index) => <div className="flex items-start gap-3 rounded-lg border border-border p-3" key={`${change.section}-${change.label}-${index}`}><Badge variant={change.kind === "removed" ? "destructive" : "outline"}>{change.kind}</Badge><div><p className="font-medium">{change.label}</p><p className="text-xs text-muted-foreground capitalize">{change.section}</p></div></div>) : <p className="text-sm text-muted-foreground">两个版本没有业务差异。</p>}</CardContent></Card>
            <Tabs defaultValue="nginx"><TabsList><TabsTrigger value="nginx">Nginx</TabsTrigger><TabsTrigger value="json">JSON</TabsTrigger></TabsList><TabsContent value="nginx"><TextDiff oldText={diff.baseNginx} newText={diff.targetNginx} className="max-h-[60dvh]" /></TabsContent><TabsContent value="json"><div className="grid gap-4 lg:grid-cols-2"><CodePanel value={diff.baseJson} /><CodePanel value={diff.targetJson} /></div></TabsContent></Tabs>
          </>
        ) : null}
      </div>
    </>
  );
}
