import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/router";
import { CopyIcon, FileKey2Icon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { useApiQuery } from "@/hooks/use-api-query";
import { ApiError, createConfigVersion, getDomain } from "@/lib/api";
import type { HeaderConfig } from "@/shared/schemas";
import { DomainTabs } from "./domain-tabs";
import { HeaderForm } from "./forms/header-form";
import { DomainPageActions } from "./domain-page-actions";

const presets: Array<Pick<HeaderConfig, "name" | "value" | "always">> = [
  { name: "Strict-Transport-Security", value: "max-age=31536000", always: true },
  { name: "X-Content-Type-Options", value: "nosniff", always: true },
  { name: "X-Frame-Options", value: "SAMEORIGIN", always: true },
  { name: "Referrer-Policy", value: "strict-origin-when-cross-origin", always: true },
];

function domainIdFromPath(asPath: string) {
  const match = asPath.match(/^\/domains\/([^/?]+)\/headers/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function scopeLabel(header: HeaderConfig, routes: Array<{ id: string; path: string }>) {
  if (header.scope.type === "server") return "Server";
  const routeId = header.scope.routeId;
  return `Route ${routes.find((route) => route.id === routeId)?.path ?? "已删除"}`;
}

export function DomainHeaders() {
  const router = useRouter();
  const domainId = domainIdFromPath(router.asPath);
  const load = React.useCallback(() => getDomain(domainId), [domainId]);
  const query = useApiQuery(load);
  const [editing, setEditing] = React.useState<HeaderConfig | "new" | null>(null);
  const [preset, setPreset] = React.useState<(typeof presets)[number] | undefined>();
  const [deleting, setDeleting] = React.useState<HeaderConfig | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const data = query.data;
  const config = data?.config;
  const editableVersion = data?.draftVersion ?? data?.activeVersion;

  const openNew = (nextPreset?: (typeof presets)[number]) => {
    setPreset(nextPreset);
    setEditing("new");
  };

  const saveHeaders = async (headers: HeaderConfig[]) => {
    if (!config || !editableVersion) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createConfigVersion(domainId, { config: { ...config, headers }, changeSummary: "更新响应 Header" }, editableVersion.snapshotChecksum);
      toast.success(result.mode === "created" ? `已创建 v${result.version.versionNumber} 草稿` : result.mode === "updated" ? `已更新 v${result.version.versionNumber} 草稿` : "没有配置变化");
      setEditing(null);
      setPreset(undefined);
      await query.refresh();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : "Header 保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (!router.isReady || !domainId) return <Skeleton className="m-8 h-96" />;

  return (
    <>
      <PageHeader
        title={data ? <span className="flex flex-wrap items-center gap-3">{data.domain.primaryHostname}<StatusBadge status={data.domain.enabled ? data.domain.runtimeStatus : "disabled"} /></span> : "Headers"}
        description="管理 server 或指定 route 的响应 Header。未发布草稿会原位更新。"
        breadcrumbs={[{ label: "Domains", href: "/domains" }, { label: data?.domain.primaryHostname ?? "Domain", href: `/domains/${domainId}/overview` }, { label: "Headers" }]}
        action={<><Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}><RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />刷新</Button><DomainPageActions domainId={domainId} data={data} /><Button size="sm" onClick={() => openNew()} disabled={!config}><PlusIcon data-icon="inline-start" />添加 Header</Button></>}
      />
      <DomainTabs domainId={domainId} active="headers" />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 md:px-8">
        {error || query.error ? <Alert variant="destructive"><AlertTitle>Headers 操作失败</AlertTitle><AlertDescription>{error ?? query.error?.message}</AlertDescription></Alert> : null}
        <Card className="border border-border">
          <CardHeader><CardTitle>推荐模板</CardTitle><CardDescription>选择模板后仍可修改名称、值、作用域和 Always 设置。</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">{presets.map((item) => <Button key={item.name} size="sm" variant="outline" onClick={() => openNew(item)} disabled={item.name === "Strict-Transport-Security" && !config?.ssl.enabled}>{item.name}</Button>)}</CardContent>
        </Card>
        {query.loading && !data ? <Skeleton className="h-72" /> : config?.headers.length ? (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Value</TableHead><TableHead>Scope</TableHead><TableHead>Always</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>{config.headers.map((header) => <TableRow key={header.id}><TableCell className="font-mono text-xs">{header.name}</TableCell><TableCell className="max-w-72 truncate font-mono text-xs">{header.value}</TableCell><TableCell>{scopeLabel(header, config.routes)}</TableCell><TableCell>{header.always ? "Yes" : "No"}</TableCell><TableCell><Badge variant={header.enabled ? "outline" : "secondary"}>{header.enabled ? "Enabled" : "Disabled"}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon-sm" variant="ghost" onClick={() => { setPreset(undefined); setEditing(header); }}><PencilIcon /><span className="sr-only">编辑 {header.name}</span></Button><Button size="icon-sm" variant="ghost" onClick={() => void saveHeaders([...config.headers, { ...header, id: crypto.randomUUID(), name: `${header.name}-Copy` }])}><CopyIcon /><span className="sr-only">复制 {header.name}</span></Button><Button size="icon-sm" variant="ghost" onClick={() => setDeleting(header)}><Trash2Icon /><span className="sr-only">删除 {header.name}</span></Button></div></TableCell></TableRow>)}</TableBody>
            </Table>
          </div>
        ) : config ? <Empty className="min-h-64 border"><EmptyHeader><EmptyMedia variant="icon"><FileKey2Icon /></EmptyMedia><EmptyTitle>尚未配置响应 Header</EmptyTitle><EmptyDescription>可从推荐模板开始，或添加自定义 Header。</EmptyDescription></EmptyHeader></Empty> : null}
      </div>
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{editing === "new" ? "添加 Header" : "编辑 Header"}</DialogTitle><DialogDescription>保存只创建草稿，不会自动发布。</DialogDescription></DialogHeader>{editing ? <HeaderForm key={`${editing === "new" ? "new" : editing.id}:${preset?.name ?? ""}`} header={editing === "new" ? undefined : editing} preset={preset} routes={config?.routes ?? []} sslEnabled={Boolean(config?.ssl.enabled)} submitting={submitting} onCancel={() => setEditing(null)} onSubmit={async (header) => { const headers = editing === "new" ? [...(config?.headers ?? []), header] : (config?.headers ?? []).map((item) => item.id === header.id ? header : item); await saveHeaders(headers); }} /> : null}</DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除 Header {deleting?.name}？</AlertDialogTitle><AlertDialogDescription>删除会更新当前草稿，线上配置不会立即改变。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (!deleting || !config) return; void saveHeaders(config.headers.filter((item) => item.id !== deleting.id)).then(() => setDeleting(null)); }}>删除 Header</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>
  );
}
