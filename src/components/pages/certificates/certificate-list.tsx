import * as React from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { useRouter } from "next/router";
import { RefreshCwIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApiQuery } from "@/hooks/use-api-query";
import { getCertificates, renewCertificate, type CertificateSummary } from "@/lib/api";
import { useLocale } from "@/hooks/use-locale";
import { formatErrorMessage } from "@/lib/i18n-error";
import { localizePath } from "@/lib/i18n-utils";

const DAY = 24 * 60 * 60 * 1000;

type DisplayStatus = "ready" | "active" | "expiring" | "expired" | "failed" | "superseded";

function displayStatus(certificate: CertificateSummary, now: number): DisplayStatus {
  if (certificate.status === "failed") return "failed";
  if (certificate.notAfter && certificate.notAfter <= now) return "expired";
  if (certificate.status === "active" && certificate.notAfter && certificate.notAfter - now <= 30 * DAY) return "expiring";
  return certificate.status as DisplayStatus;
}

function CertificateStatus({ certificate, now }: { certificate: CertificateSummary; now: number }) {
  const { t } = useTranslation(["common", "certificates"]);
  const status = displayStatus(certificate, now);
  if (status === "active" && !certificate.domainEnabled) {
    return <Badge variant="outline">{t("certificates:activeDomainDisabled")}</Badge>;
  }
  return <StatusBadge status={status} />;
}

export function CertificateList() {
  const { t } = useTranslation(["common", "certificates"]);
  const router = useRouter();
  const locale = useLocale();
  const query = useApiQuery(React.useCallback(() => getCertificates(), []));
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [autoRenewOnly, setAutoRenewOnly] = React.useState(false);
  const [renewingId, setRenewingId] = React.useState<string>();
  const [now] = React.useState(() => Date.now());
  const dateFormatter = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" });
  const items = query.data?.items ?? [];
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = items.filter((certificate) => {
    const effectiveStatus = displayStatus(certificate, now);
    return (!normalizedSearch || certificate.primaryHostname.includes(normalizedSearch) || certificate.sans.some((san) => san.includes(normalizedSearch)))
      && (status === "all" || effectiveStatus === status)
      && (!autoRenewOnly || certificate.autoRenew);
  });
  const summary = {
    ready: items.filter((item) => displayStatus(item, now) === "ready").length,
    active: items.filter((item) => item.status === "active").length,
    expiring: items.filter((item) => displayStatus(item, now) === "expiring").length,
    expired: items.filter((item) => displayStatus(item, now) === "expired").length,
    failed: items.filter((item) => displayStatus(item, now) === "failed").length,
  };

  const renew = async (certificate: CertificateSummary) => {
    setRenewingId(certificate.id);
    try {
      const result = await renewCertificate(certificate.domainId);
      toast.success(t("certificates:renewalOrderCreated"));
      await router.push(localizePath(`/domains/ssl?id=${certificate.domainId}&orderId=${result.order.id}`, locale));
    } catch (error) {
      toast.error(formatErrorMessage(t, error, "certificates:renewalOrderFailed"));
      setRenewingId(undefined);
    }
  };

  return <>
    <PageHeader
      title={t("certificates:title")}
      description={t("certificates:description")}
      breadcrumbs={[{ label: t("certificates:title") }]}
      action={<Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}><RefreshCwIcon className={query.refreshing ? "animate-spin" : undefined} />{t("certificates:refresh")}</Button>}
    />
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 md:px-8">
      {query.error ? <Alert variant="destructive"><AlertTitle>{t("certificates:loadFailed")}</AlertTitle><AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription></Alert> : null}

      {query.loading ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <Skeleton className="h-24" key={index} />)}</div> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Object.entries(summary).map(([key, value]) => <Card className="border border-border shadow-none" key={key}><CardHeader className="pb-2"><CardTitle className="text-sm font-normal capitalize text-muted-foreground">{t(`common:status.${key}`)}</CardTitle></CardHeader><CardContent className="font-mono text-2xl">{value}</CardContent></Card>)}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
        <label className="relative"><span className="mb-2 block text-sm font-medium">{t("certificates:filters.search.label")}</span><SearchIcon className="pointer-events-none absolute bottom-2.5 left-3 size-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="example.com" /></label>
        <label><span className="mb-2 block text-sm font-medium">{t("certificates:filters.status.label")}</span><Select value={status} onChange={(value) => setStatus(value ?? "all")} options={[{ value: "all", label: t("certificates:status.all") }, { value: "ready", label: t("common:status.ready") }, { value: "active", label: t("common:status.active") }, { value: "expiring", label: t("common:status.expiring") }, { value: "expired", label: t("common:status.expired") }, { value: "failed", label: t("common:status.failed") }, { value: "superseded", label: t("common:status.superseded") }]} /></label>
        <label className="flex h-10 items-center gap-3 rounded-md border border-border px-3 text-sm"><Switch checked={autoRenewOnly} onCheckedChange={setAutoRenewOnly} />{t("certificates:filters.autoRenewOnly")}</label>
      </div>

      {!query.loading && !items.length ? <Empty className="border border-dashed"><EmptyHeader><EmptyMedia variant="icon"><ShieldCheckIcon /></EmptyMedia><EmptyTitle>{t("certificates:empty.title")}</EmptyTitle><EmptyDescription>{t("certificates:empty.description")}</EmptyDescription></EmptyHeader><Button asChild><LocalizedLink href="/domains">{t("certificates:viewDomains")}</LocalizedLink></Button></Empty> : null}
      {!query.loading && items.length && !filtered.length ? <Empty className="border border-dashed"><EmptyHeader><EmptyTitle>{t("certificates:noMatches.title")}</EmptyTitle><EmptyDescription>{t("certificates:noMatches.description")}</EmptyDescription></EmptyHeader></Empty> : null}

      {filtered.length ? <>
        <div className="hidden overflow-hidden rounded-md border border-border md:block">
          <Table><TableHeader><TableRow><TableHead>{t("certificates:columns.primaryDomain")}</TableHead><TableHead>{t("certificates:columns.san")}</TableHead><TableHead>{t("certificates:columns.provider")}</TableHead><TableHead>{t("certificates:columns.expires")}</TableHead><TableHead>{t("certificates:columns.autoRenew")}</TableHead><TableHead>{t("certificates:columns.status")}</TableHead><TableHead className="text-right">{t("certificates:columns.actions")}</TableHead></TableRow></TableHeader><TableBody>{filtered.map((certificate) => <TableRow key={certificate.id}><TableCell><LocalizedLink className="font-medium hover:underline" href={`/domains/ssl?id=${certificate.domainId}`}>{certificate.primaryHostname}</LocalizedLink>{!certificate.domainEnabled ? <p className="mt-1 text-xs text-muted-foreground">{t("certificates:business503")}</p> : null}</TableCell><TableCell className="max-w-72 truncate text-sm text-muted-foreground">{certificate.sans.join(", ")}</TableCell><TableCell>{certificate.provider}</TableCell><TableCell>{certificate.notAfter ? dateFormatter.format(certificate.notAfter) : t("certificates:unknown")}</TableCell><TableCell>{certificate.autoRenew ? t("certificates:autoRenewOn") : t("certificates:autoRenewOff")}</TableCell><TableCell><CertificateStatus certificate={certificate} now={now} /></TableCell><TableCell><div className="flex justify-end gap-2"><Button size="sm" variant="outline" asChild><LocalizedLink href={`/domains/ssl?id=${certificate.domainId}&orderId=${certificate.acmeOrderId}`}>{t("certificates:viewSourceOrder")}</LocalizedLink></Button><Button size="sm" variant="outline" asChild><LocalizedLink href={`/domains/ssl?id=${certificate.domainId}`}>{t("certificates:manage")}</LocalizedLink></Button>{certificate.status === "active" ? <Button size="sm" disabled={Boolean(renewingId)} onClick={() => void renew(certificate)}>{renewingId === certificate.id ? <RefreshCwIcon className="animate-spin" /> : null}{t("certificates:renew")}</Button> : null}</div></TableCell></TableRow>)}</TableBody></Table>
        </div>
        <div className="grid gap-3 md:hidden">{filtered.map((certificate) => <Card className="border border-border shadow-none" key={certificate.id}><CardHeader><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate text-base">{certificate.primaryHostname}</CardTitle><p className="mt-1 truncate text-xs text-muted-foreground">{certificate.sans.join(", ")}</p></div><CertificateStatus certificate={certificate} now={now} /></div></CardHeader><CardContent className="flex flex-col gap-4"><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">{t("certificates:columns.expires")}</dt><dd className="mt-1">{certificate.notAfter ? dateFormatter.format(certificate.notAfter) : t("certificates:unknown")}</dd></div><div><dt className="text-xs text-muted-foreground">{t("certificates:columns.autoRenew")}</dt><dd className="mt-1">{certificate.autoRenew ? t("certificates:autoRenewOn") : t("certificates:autoRenewOff")}</dd></div></dl><div className="grid grid-cols-2 gap-2"><Button variant="outline" asChild><LocalizedLink href={`/domains/ssl?id=${certificate.domainId}&orderId=${certificate.acmeOrderId}`}>{t("certificates:viewSourceOrder")}</LocalizedLink></Button><Button asChild><LocalizedLink href={`/domains/ssl?id=${certificate.domainId}`}>{t("certificates:manage")}</LocalizedLink></Button></div></CardContent></Card>)}</div>
      </> : null}
    </div>
  </>;
}
