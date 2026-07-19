import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/router";
import { CopyIcon, NetworkIcon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { DomainTabs } from "./domain-tabs";
import { RouteForm } from "./forms/route-form";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { useApiQuery } from "@/hooks/use-api-query";
import { ApiError, createConfigVersion, getDomain } from "@/lib/api";
import type { RouteConfig } from "@/shared/schemas";
import { DomainPageActions } from "./domain-page-actions";

function domainIdFromPath(asPath: string) {
  const match = asPath.match(/^\/domains\/([^/?]+)\/routes/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function routeTarget(route: RouteConfig) {
  if (route.type === "static") return route.root;
  return route.target;
}

export function DomainRoutes() {
  const router = useRouter();
  const domainId = domainIdFromPath(router.asPath);
  const load = React.useCallback(() => getDomain(domainId), [domainId]);
  const query = useApiQuery(load);
  const [editing, setEditing] = React.useState<RouteConfig | "new" | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [deleting, setDeleting] = React.useState<RouteConfig | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const data = query.data;
  const config = data?.config;
  const editableVersion = data?.draftVersion ?? data?.activeVersion;

  const saveRoutes = async (routes: RouteConfig[]) => {
    if (!config || !editableVersion) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createConfigVersion(domainId, { config: { ...config, routes }, changeSummary: "更新路由配置" }, editableVersion.snapshotChecksum);
      toast.success(result.mode === "created" ? `已创建 v${result.version.versionNumber} 草稿` : result.mode === "updated" ? `已更新 v${result.version.versionNumber} 草稿` : "没有配置变化");
      setEditing(null);
      await query.refresh();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : "路由保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (!router.isReady || !domainId) return <Skeleton className="m-8 h-96" />;

  return (
    <>
      <PageHeader
        title={data ? <span className="flex flex-wrap items-center gap-3">{data.domain.primaryHostname}<StatusBadge status={data.domain.enabled ? data.domain.runtimeStatus : "disabled"} /></span> : "Routes"}
        description="编辑 server 下的普通前缀 location。未发布草稿会原位更新。"
        breadcrumbs={[
          { label: "Domains", href: "/domains" },
          { label: data?.domain.primaryHostname ?? "Domain", href: `/domains/${domainId}/overview` },
          { label: "Routes" },
        ]}
        action={
          <>
            <Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}><RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />刷新</Button>
            <DomainPageActions domainId={domainId} data={data} />
            <Button size="sm" onClick={() => setEditing("new")} disabled={!config}><PlusIcon data-icon="inline-start" />添加路由</Button>
          </>
        }
      />
      <DomainTabs domainId={domainId} active="routes" />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 md:px-8">
        {error || query.error ? <Alert variant="destructive"><AlertTitle>Routes 操作失败</AlertTitle><AlertDescription>{error ?? query.error?.message}</AlertDescription></Alert> : null}
        {query.loading && !data ? <Skeleton className="h-80" /> : config ? (
          config.routes.length ? (
            <div className="rounded-md border border-border bg-card">
              <Table>
                <TableHeader><TableRow><TableHead>Path</TableHead><TableHead>Type</TableHead><TableHead>Target</TableHead><TableHead>Options</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {config.routes.map((route) => (
                    <TableRow key={route.id}>
                      <TableCell className="font-mono">{route.path}</TableCell>
                      <TableCell className="capitalize">{route.type}</TableCell>
                      <TableCell className="max-w-72 truncate font-mono text-xs">{routeTarget(route)}</TableCell>
                      <TableCell className="text-muted-foreground">{route.type === "proxy" ? `${route.readTimeoutSeconds}s${route.websocket ? ", WS" : ""}` : route.type === "redirect" ? route.statusCode : route.spaFallback ? "SPA" : "Static"}</TableCell>
                      <TableCell><Badge variant={route.enabled ? "outline" : "secondary"}>{route.enabled ? "Enabled" : "Disabled"}</Badge></TableCell>
                      <TableCell><div className="flex justify-end gap-1"><Button size="icon-sm" variant="ghost" onClick={() => setEditing(route)}><PencilIcon /><span className="sr-only">编辑 {route.path}</span></Button><Button size="icon-sm" variant="ghost" onClick={() => void saveRoutes([...config.routes, { ...route, id: crypto.randomUUID(), path: `${route.path === "/" ? "" : route.path}-copy`, order: config.routes.length }])}><CopyIcon /><span className="sr-only">复制 {route.path}</span></Button><Button size="icon-sm" variant="ghost" onClick={() => setDeleting(route)}><Trash2Icon /><span className="sr-only">删除 {route.path}</span></Button></div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><NetworkIcon /></EmptyMedia><EmptyTitle>尚未添加路由</EmptyTitle><EmptyDescription>发布后除 ACME challenge 外的请求将返回 404。</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => setEditing("new")}><PlusIcon data-icon="inline-start" />添加第一条路由</Button></EmptyContent></Empty>
          )
        ) : null}
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing === "new" ? "添加路由" : "编辑路由"}</DialogTitle><DialogDescription>路由保存到当前完整草稿，不会自动发布。</DialogDescription></DialogHeader>
          {editing ? <RouteForm route={editing === "new" ? undefined : editing} existingPaths={config?.routes.map((route) => route.path) ?? []} submitting={submitting} onCancel={() => setEditing(null)} onSubmit={async (route) => { const routes = editing === "new" ? [...(config?.routes ?? []), route] : (config?.routes ?? []).map((item) => item.id === route.id ? route : item); await saveRoutes(routes); }} /> : null}
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>删除路由 {deleting?.path}？</AlertDialogTitle><AlertDialogDescription>删除会更新当前草稿，线上配置不会立即改变。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (!deleting || !config) return; void saveRoutes(config.routes.filter((item) => item.id !== deleting.id)).then(() => setDeleting(null)); }}>删除路由</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
