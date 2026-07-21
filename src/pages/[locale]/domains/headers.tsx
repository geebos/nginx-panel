import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "@/hooks/use-router";
import { toast } from "sonner";
import { CopyIcon, FileKey2Icon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DomainPageActions } from "@/components/pages/domains/page-actions";
import { DomainTabs } from "@/components/pages/domains/tabs";
import { HeaderForm } from "@/components/pages/domains/forms/header-form";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { domainDisplayStatus } from "@/lib/domain-status";
import { useApiQuery } from "@/hooks/use-api-query";
import { createConfigVersion, getDomain } from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n/error";
import { randomUUID } from "@/lib/utils";
import type { HeaderConfig } from "@/shared/schemas";
import type { TFunction } from "i18next";

const presets: Array<Pick<HeaderConfig, "name" | "value" | "always">> = [
  { name: "Strict-Transport-Security", value: "max-age=31536000", always: true },
  { name: "X-Content-Type-Options", value: "nosniff", always: true },
  { name: "X-Frame-Options", value: "SAMEORIGIN", always: true },
  { name: "Referrer-Policy", value: "strict-origin-when-cross-origin", always: true },
];

function scopeLabel(t: TFunction, header: HeaderConfig, routes: Array<{ id: string; path: string }>) {
  if (header.scope.type === "server") return t("domains:headers.scopeServer");
  const routeId = header.scope.routeId;
  const path = routes.find((route) => route.id === routeId)?.path;
  return path ? t("domains:headers.scopeRoute", { path }) : t("domains:headers.scopeDeleted");
}

function DomainHeaders({ domainId }: { domainId: string }) {
  const { t } = useTranslation(["common", "domains"]);
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
      const result = await createConfigVersion(domainId, { config: { ...config, headers }, changeSummary: t("domains:headers.changeSummary") }, editableVersion.snapshotChecksum);
      toast.success(result.mode === "created" ? t("domains:common.toast.draftCreated", { n: result.version.versionNumber }) : result.mode === "updated" ? t("domains:common.toast.draftUpdated", { n: result.version.versionNumber }) : t("domains:common.toast.noChange"));
      setEditing(null);
      setPreset(undefined);
      await query.refresh();
    } catch (nextError) {
      setError(formatErrorMessage(t, nextError, "domains:headers.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={data ? <span className="flex flex-wrap items-center gap-3">{data.domain.primaryHostname}<StatusBadge status={domainDisplayStatus(data.domain)} /></span> : t("domains:headers.titleFallback")}
        description={t("domains:headers.description")}
        breadcrumbs={[{ label: t("domains:common.breadcrumbs.domains"), href: "/domains" }, { label: data?.domain.primaryHostname ?? t("domains:common.breadcrumbs.domain"), href: `/domains/overview?id=${domainId}` }, { label: t("domains:common.breadcrumbs.headers") }]}
        action={<><Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}><RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />{t("domains:common.actions.refresh")}</Button><DomainPageActions domainId={domainId} data={data} /><Button size="sm" onClick={() => openNew()} disabled={!config}><PlusIcon data-icon="inline-start" />{t("domains:headers.addHeader")}</Button></>}
      />
      <DomainTabs domainId={domainId} active="headers" />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 md:px-8">
        {error || query.error ? <Alert variant="destructive"><AlertTitle>{t("domains:headers.loadFailed")}</AlertTitle><AlertDescription>{error ?? (query.error ? formatErrorMessage(t, query.error) : null)}</AlertDescription></Alert> : null}
        <Card className="border border-border">
          <CardHeader><CardTitle>{t("domains:headers.presetsCard.title")}</CardTitle><CardDescription>{t("domains:headers.presetsCard.description")}</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">{presets.map((item) => <Button key={item.name} size="sm" variant="outline" onClick={() => openNew(item)} disabled={item.name === "Strict-Transport-Security" && !config?.ssl.enabled}>{item.name}</Button>)}</CardContent>
        </Card>
        {query.loading && !data ? <Skeleton className="h-72" /> : config?.headers.length ? (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table><TableHeader><TableRow><TableHead>{t("domains:headers.columns.name")}</TableHead><TableHead>{t("domains:headers.columns.value")}</TableHead><TableHead>{t("domains:headers.columns.scope")}</TableHead><TableHead>{t("domains:headers.columns.always")}</TableHead><TableHead>{t("domains:headers.columns.status")}</TableHead><TableHead className="text-right">{t("domains:headers.columns.actions")}</TableHead></TableRow></TableHeader>
              <TableBody>{config.headers.map((header) => <TableRow key={header.id}><TableCell className="font-mono text-xs">{header.name}</TableCell><TableCell className="max-w-72 truncate font-mono text-xs">{header.value}</TableCell><TableCell>{scopeLabel(t, header, config.routes)}</TableCell><TableCell>{header.always ? t("domains:common.status.yes") : t("domains:common.status.no")}</TableCell><TableCell><Badge variant={header.enabled ? "outline" : "secondary"}>{header.enabled ? t("domains:common.status.enabled") : t("domains:common.status.disabled")}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon-sm" variant="ghost" onClick={() => { setPreset(undefined); setEditing(header); }}><PencilIcon /><span className="sr-only">{t("domains:headers.srOnly.edit", { name: header.name })}</span></Button><Button size="icon-sm" variant="ghost" onClick={() => void saveHeaders([...config.headers, { ...header, id: randomUUID(), name: `${header.name}-Copy` }])}><CopyIcon /><span className="sr-only">{t("domains:headers.srOnly.copy", { name: header.name })}</span></Button><Button size="icon-sm" variant="ghost" onClick={() => setDeleting(header)}><Trash2Icon /><span className="sr-only">{t("domains:headers.srOnly.delete", { name: header.name })}</span></Button></div></TableCell></TableRow>)}</TableBody>
            </Table>
          </div>
        ) : config ? <Empty className="min-h-64 border"><EmptyHeader><EmptyMedia variant="icon"><FileKey2Icon /></EmptyMedia><EmptyTitle>{t("domains:headers.empty.title")}</EmptyTitle><EmptyDescription>{t("domains:headers.empty.description")}</EmptyDescription></EmptyHeader></Empty> : null}
      </div>
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{editing === "new" ? t("domains:headers.dialog.addTitle") : t("domains:headers.dialog.editTitle")}</DialogTitle><DialogDescription>{t("domains:headers.dialog.description")}</DialogDescription></DialogHeader>{editing ? <HeaderForm key={`${editing === "new" ? "new" : editing.id}:${preset?.name ?? ""}`} header={editing === "new" ? undefined : editing} preset={preset} routes={config?.routes ?? []} sslEnabled={Boolean(config?.ssl.enabled)} submitting={submitting} onCancel={() => setEditing(null)} onSubmit={async (header) => { const headers = editing === "new" ? [...(config?.headers ?? []), header] : (config?.headers ?? []).map((item) => item.id === header.id ? header : item); await saveHeaders(headers); }} /> : null}</DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("domains:headers.deleteDialog.title", { name: deleting?.name ?? "" })}</AlertDialogTitle><AlertDialogDescription>{t("domains:headers.deleteDialog.description")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("domains:common.actions.cancel")}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (!deleting || !config) return; void saveHeaders(config.headers.filter((item) => item.id === deleting.id)).then(() => setDeleting(null)); }}>{t("domains:headers.deleteDialog.action")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>
  );
}

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "domains"]);

export default function DomainHeadersPage() {
  const router = useRouter();
  const domainId = typeof router.query.id === "string" ? router.query.id : "";
  if (!router.isReady || !domainId) return <Page className="px-0 pb-16"><Skeleton className="m-8 h-96" /></Page>;
  return <Page className="px-0 pb-16"><DomainHeaders domainId={domainId} /></Page>;
}
