import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "@/hooks/use-router";
import { toast } from "sonner";
import { CopyIcon, NetworkIcon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DomainPageActions } from "@/components/pages/domains/page-actions";
import { DomainTabs } from "@/components/pages/domains/tabs";
import { RouteForm } from "@/components/pages/domains/forms/route-form";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { useApiQuery } from "@/hooks/use-api-query";
import { createConfigVersion, getDomain } from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n/error";
import type { RouteConfig } from "@/shared/schemas";

function routeTarget(route: RouteConfig) {
  if (route.type === "static") return route.root;
  return route.target;
}

function DomainRoutes({ domainId }: { domainId: string }) {
  const { t } = useTranslation(["common", "domains"]);
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
      const result = await createConfigVersion(domainId, { config: { ...config, routes }, changeSummary: t("domains:routes.changeSummary") }, editableVersion.snapshotChecksum);
      toast.success(result.mode === "created" ? t("domains:common.toast.draftCreated", { n: result.version.versionNumber }) : result.mode === "updated" ? t("domains:common.toast.draftUpdated", { n: result.version.versionNumber }) : t("domains:common.toast.noChange"));
      setEditing(null);
      await query.refresh();
    } catch (nextError) {
      setError(formatErrorMessage(t, nextError, "domains:routes.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={data ? <span className="flex flex-wrap items-center gap-3">{data.domain.primaryHostname}<StatusBadge status={data.domain.enabled ? data.domain.runtimeStatus : "disabled"} /></span> : t("domains:routes.titleFallback")}
        description={t("domains:routes.description")}
        breadcrumbs={[
          { label: t("domains:common.breadcrumbs.domains"), href: "/domains" },
          { label: data?.domain.primaryHostname ?? t("domains:common.breadcrumbs.domain"), href: `/domains/overview?id=${domainId}` },
          { label: t("domains:common.breadcrumbs.routes") },
        ]}
        action={
          <>
            <Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}><RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />{t("domains:common.actions.refresh")}</Button>
            <DomainPageActions domainId={domainId} data={data} />
            <Button size="sm" onClick={() => setEditing("new")} disabled={!config}><PlusIcon data-icon="inline-start" />{t("domains:routes.addRoute")}</Button>
          </>
        }
      />
      <DomainTabs domainId={domainId} active="routes" />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 md:px-8">
        {error || query.error ? <Alert variant="destructive"><AlertTitle>{t("domains:routes.loadFailed")}</AlertTitle><AlertDescription>{error ?? (query.error ? formatErrorMessage(t, query.error) : null)}</AlertDescription></Alert> : null}
        {query.loading && !data ? <Skeleton className="h-80" /> : config ? (
          config.routes.length ? (
            <div className="rounded-md border border-border bg-card">
              <Table>
                <TableHeader><TableRow><TableHead>{t("domains:routes.columns.path")}</TableHead><TableHead>{t("domains:routes.columns.type")}</TableHead><TableHead>{t("domains:routes.columns.target")}</TableHead><TableHead>{t("domains:routes.columns.options")}</TableHead><TableHead>{t("domains:routes.columns.status")}</TableHead><TableHead className="text-right">{t("domains:routes.columns.actions")}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {config.routes.map((route) => (
                    <TableRow key={route.id}>
                      <TableCell className="font-mono">{route.path}</TableCell>
                      <TableCell className="capitalize">{route.type}</TableCell>
                      <TableCell className="max-w-72 truncate font-mono text-xs">{routeTarget(route)}</TableCell>
                      <TableCell className="text-muted-foreground">{route.type === "proxy" ? `${route.readTimeoutSeconds}s${route.websocket ? `, ${t("domains:routes.options.ws")}` : ""}` : route.type === "redirect" ? route.statusCode : route.spaFallback ? t("domains:routes.options.spa") : t("domains:routes.options.static")}</TableCell>
                      <TableCell><Badge variant={route.enabled ? "outline" : "secondary"}>{route.enabled ? t("domains:common.status.enabled") : t("domains:common.status.disabled")}</Badge></TableCell>
                      <TableCell><div className="flex justify-end gap-1"><Button size="icon-sm" variant="ghost" onClick={() => setEditing(route)}><PencilIcon /><span className="sr-only">{t("domains:routes.srOnly.edit", { path: route.path })}</span></Button><Button size="icon-sm" variant="ghost" onClick={() => void saveRoutes([...config.routes, { ...route, id: crypto.randomUUID(), path: `${route.path === "/" ? "" : route.path}-copy`, order: config.routes.length }])}><CopyIcon /><span className="sr-only">{t("domains:routes.srOnly.copy", { path: route.path })}</span></Button><Button size="icon-sm" variant="ghost" onClick={() => setDeleting(route)}><Trash2Icon /><span className="sr-only">{t("domains:routes.srOnly.delete", { path: route.path })}</span></Button></div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><NetworkIcon /></EmptyMedia><EmptyTitle>{t("domains:routes.empty.title")}</EmptyTitle><EmptyDescription>{t("domains:routes.empty.description")}</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => setEditing("new")}><PlusIcon data-icon="inline-start" />{t("domains:routes.empty.addFirst")}</Button></EmptyContent></Empty>
          )
        ) : null}
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing === "new" ? t("domains:routes.dialog.addTitle") : t("domains:routes.dialog.editTitle")}</DialogTitle><DialogDescription>{t("domains:routes.dialog.description")}</DialogDescription></DialogHeader>
          {editing ? <RouteForm route={editing === "new" ? undefined : editing} existingPaths={config?.routes.map((route) => route.path) ?? []} submitting={submitting} onCancel={() => setEditing(null)} onSubmit={async (route) => { const routes = editing === "new" ? [...(config?.routes ?? []), route] : (config?.routes ?? []).map((item) => item.id === route.id ? route : item); await saveRoutes(routes); }} /> : null}
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("domains:routes.deleteDialog.title", { path: deleting?.path ?? "" })}</AlertDialogTitle><AlertDialogDescription>{t("domains:routes.deleteDialog.description")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("domains:common.actions.cancel")}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (!deleting || !config) return; void saveRoutes(config.routes.filter((item) => item.id === deleting.id)).then(() => setDeleting(null)); }}>{t("domains:routes.deleteDialog.action")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "domains"]);

export default function DomainRoutesPage() {
  const router = useRouter();
  const domainId = typeof router.query.id === "string" ? router.query.id : "";
  if (!router.isReady || !domainId) return <Page className="px-0 pb-16"><Skeleton className="m-8 h-96" /></Page>;
  return <Page className="px-0 pb-16"><DomainRoutes domainId={domainId} /></Page>;
}
