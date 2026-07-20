import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { useRouter } from "next/router";
import { ArrowLeftIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DomainTabs } from "@/components/pages/domains/domain-tabs";
import { SslSettingsForm } from "@/components/pages/domains/forms/ssl-form";
import { useApiQuery } from "@/hooks/use-api-query";
import { useLocale } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n-utils";
import { createCertificateOrder, createConfigVersion, getCertificateOrder, getCloudflareCredentials, getDomain, getDomainCertificateOrders, getDomainCertificates, recheckCertificateOrder, renewCertificate, retryCertificateActivation, retryCloudflareCleanup } from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n-error";
import type { DomainConfig } from "@/shared/schemas";

const terminalOrders = ["succeeded", "failed", "expired", "cancelled"];

function DomainSsl({ domainId, orderId }: { domainId: string; orderId: string }) {
  const { t } = useTranslation(["common", "domains"]);
  const router = useRouter();
  const locale = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const load = React.useCallback(async () => {
    const domain = await getDomain(domainId);
    if (orderId) return { domain, order: await getCertificateOrder(domainId, orderId), orders: null, certificates: null, credentials: null };
    const [orders, certificates, credentials] = await Promise.all([getDomainCertificateOrders(domainId), getDomainCertificates(domainId), getCloudflareCredentials()]);
    return { domain, order: null, orders: orders.items, certificates: certificates.items, credentials: credentials.items.filter((credential) => credential.status === "active") };
  }, [domainId, orderId]);
  const query = useApiQuery(load);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    const detail = query.data?.order;
    if (!orderId || !detail) return;
    const activationRunning = detail.order.status === "succeeded" && (!detail.activation || detail.activation.status === "pending" || ["queued", "running"].includes(detail.deployment?.status ?? ""));
    if (terminalOrders.includes(detail.order.status) && !activationRunning) return;
    const timer = window.setInterval(() => void query.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [orderId, query]);

  const data = query.data;
  const config = data?.domain.config;
  const editableVersion = data?.domain.draftVersion ?? data?.domain.activeVersion;
  const activeOrder = data?.orders?.find((order) => !terminalOrders.includes(order.status));
  const activeCertificate = data?.certificates?.find((certificate) => certificate.status === "active");

  if (orderId) {
    const detail = data?.order;
    return <>
      <PageHeader title={detail ? `${detail.order.replacesCertificateId ? t("domains:ssl.orderDetail.titleRenewal") : t("domains:ssl.orderDetail.titleOrder")} ${detail.order.id.slice(0, 8)}` : t("domains:ssl.orderDetail.titleFallback")} description={t("domains:ssl.orderDetail.description")} breadcrumbs={[{ label: t("domains:common.breadcrumbs.domains"), href: "/domains" }, { label: data?.domain.domain.primaryHostname ?? t("domains:common.breadcrumbs.domain"), href: `/domains/overview?id=${domainId}` }, { label: t("domains:common.breadcrumbs.ssl"), href: `/domains/ssl?id=${domainId}` }, { label: t("domains:common.breadcrumbs.order") }]} action={<Button size="sm" variant="outline" asChild><LocalizedLink href={`/domains/ssl?id=${domainId}`}><ArrowLeftIcon />{t("domains:ssl.orderDetail.backToSsl")}</LocalizedLink></Button>} />
      <DomainTabs domainId={domainId} active="ssl" />
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>{t("domains:ssl.orderDetail.loadFailed")}</AlertTitle><AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription></Alert> : null}
        {!detail ? <Skeleton className="h-80" /> : <><Card className="border border-border"><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>{t("domains:ssl.orderDetail.statusCard.title")}</CardTitle><StatusBadge status={detail.order.status} /></div><CardDescription>{detail.order.environment} · {detail.order.validationMethod}{detail.order.dnsProvider ? ` / ${detail.order.dnsProvider}` : ""}</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">{t("domains:ssl.orderDetail.identifiers")}</p><p className="mt-1 text-sm">{detail.order.identifiers.join(", ")}</p></div><div><p className="text-xs text-muted-foreground">{t("domains:ssl.orderDetail.createdAt")}</p><p className="mt-1 text-sm">{dateFormatter.format(detail.order.createdAt)}</p></div></CardContent></Card>{detail.order.errorMessage && detail.order.status !== "succeeded" ? <Alert variant="destructive"><AlertTitle>{t("domains:ssl.orderDetail.processFailed")}</AlertTitle><AlertDescription>{detail.order.errorMessage}</AlertDescription></Alert> : null}{detail.order.cleanupStatus === "failed" ? <Alert><AlertTitle>{t("domains:ssl.orderDetail.cleanupFailed")}</AlertTitle><AlertDescription className="flex items-center justify-between gap-3"><span>{detail.order.errorMessage ?? t("domains:ssl.orderDetail.cleanupFailedDesc")}</span><Button size="sm" variant="outline" onClick={() => { void retryCloudflareCleanup(domainId, orderId).then(() => query.refresh()).catch((caught: Error) => setError(formatErrorMessage(t, caught, "domains:ssl.orderDetail.operationFailed"))); }}><RefreshCwIcon />{t("domains:ssl.orderDetail.retryCleanup")}</Button></AlertDescription></Alert> : null}{detail.order.status === "preparing" ? <Alert><ShieldCheckIcon /><AlertTitle>{t("domains:ssl.orderDetail.preparingTitle")}</AlertTitle><AlertDescription>{t("domains:ssl.orderDetail.preparingDesc")}</AlertDescription></Alert> : null}{detail.challenges.length ? <Card className="border border-border"><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>{t("domains:ssl.orderDetail.challengesTitle")}</CardTitle><CardDescription>{detail.order.validationMethod === "dns-01" ? t("domains:ssl.orderDetail.challengesDescDns") : t("domains:ssl.orderDetail.challengesDescHttp")}</CardDescription></div>{["waiting_http", "waiting_dns", "validating"].includes(detail.order.status) ? <Button size="sm" variant="outline" onClick={() => { void recheckCertificateOrder(domainId, orderId).then((result) => { toast.success(result.debounced ? t("domains:ssl.orderDetail.toastDebounced") : t("domains:ssl.orderDetail.toastScheduled")); return query.refresh(); }).catch((caught: Error) => setError(formatErrorMessage(t, caught, "domains:ssl.orderDetail.operationFailed"))); }}><RefreshCwIcon />{t("domains:ssl.orderDetail.recheck")}</Button> : null}</div></CardHeader><CardContent className="flex flex-col gap-3">{detail.challenges.map((challenge) => <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-[minmax(0,1fr)_auto]" key={challenge.id}><div><p className="font-medium">{challenge.hostname}</p>{challenge.dnsRecordName ? <><p className="mt-2 font-mono text-xs">{challenge.dnsRecordName}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{challenge.dnsRecordValue}</p></> : <p className="mt-1 text-sm text-muted-foreground">{t("domains:ssl.orderDetail.httpReady")}</p>}</div><StatusBadge status={challenge.status} /></div>)}</CardContent></Card> : null}{detail.certificate ? <Card className="border border-border"><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>{t("domains:ssl.orderDetail.activationTitle")}</CardTitle><CardDescription>{t("domains:ssl.orderDetail.activationDesc")}</CardDescription></div><StatusBadge status={detail.deployment?.status ?? detail.activation?.status ?? detail.certificate.status} /></div></CardHeader><CardContent className="flex flex-col gap-3"><div className="grid gap-3 text-sm sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">{t("domains:ssl.orderDetail.certificate")}</p><p className="mt-1 font-mono">{detail.certificate.id.slice(0, 8)}</p></div><div><p className="text-xs text-muted-foreground">{t("domains:ssl.orderDetail.configVersion")}</p><p className="mt-1 font-mono">{detail.activation?.configVersionId?.slice(0, 8) ?? t("domains:ssl.orderDetail.waitingCreate")}</p></div></div>{detail.deployment ? <Button variant="outline" asChild><LocalizedLink href={`/deployments/detail?id=${detail.deployment.id}`}>{t("domains:ssl.orderDetail.viewDeployment", { status: detail.deployment.status })}</LocalizedLink></Button> : null}{detail.activation?.errorMessage || detail.deployment?.errorMessage ? <Alert variant="destructive"><AlertTitle>{t("domains:ssl.orderDetail.activationFailed")}</AlertTitle><AlertDescription>{detail.activation?.errorMessage ?? detail.deployment?.errorMessage}</AlertDescription></Alert> : null}{detail.activation?.status === "failed" || detail.deployment?.status === "failed" ? <Button onClick={() => { setError(undefined); void retryCertificateActivation(domainId, orderId).then(() => { toast.success(t("domains:ssl.orderDetail.activationRetried")); return query.refresh(); }).catch((caught: Error) => setError(formatErrorMessage(t, caught, "domains:ssl.orderDetail.operationFailed"))); }}><RefreshCwIcon />{t("domains:ssl.orderDetail.retryActivation")}</Button> : null}</CardContent></Card> : null}{error ? <Alert variant="destructive"><AlertTitle>{t("domains:ssl.orderDetail.operationFailed")}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}</>}
      </div>
    </>;
  }

  return <>
    <PageHeader title={data ? <span className="flex items-center gap-3">{data.domain.domain.primaryHostname}<StatusBadge status={config?.ssl.certificateId ? "active" : config?.ssl.enabled ? "pending" : "disabled"} /></span> : t("domains:ssl.titleFallback")} description={t("domains:ssl.description")} breadcrumbs={[{ label: t("domains:common.breadcrumbs.domains"), href: "/domains" }, { label: data?.domain.domain.primaryHostname ?? t("domains:common.breadcrumbs.domain"), href: `/domains/overview?id=${domainId}` }, { label: t("domains:common.breadcrumbs.ssl") }]} action={<Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}><RefreshCwIcon className={query.refreshing ? "animate-spin" : undefined} />{t("domains:common.actions.refresh")}</Button>} />
    <DomainTabs domainId={domainId} active="ssl" />
    <div className="mx-auto grid w-full max-w-[1440px] gap-5 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_380px] md:px-8">
      <div>{error || query.error ? <Alert className="mb-5" variant="destructive"><AlertTitle>{t("domains:ssl.loadFailed")}</AlertTitle><AlertDescription>{error ?? (query.error ? formatErrorMessage(t, query.error) : null)}</AlertDescription></Alert> : null}{activeCertificate && data && !data.domain.domain.enabled ? <Alert className="mb-5"><AlertTitle>{t("domains:ssl.disabledAlert.title")}</AlertTitle><AlertDescription>{t("domains:ssl.disabledAlert.description")}</AlertDescription></Alert> : null}{config && editableVersion ? <SslSettingsForm key={editableVersion.snapshotChecksum} initial={config.ssl} credentials={data.credentials ?? []} certificateActive={Boolean(activeCertificate)} submitting={submitting} orderRunning={Boolean(activeOrder)} onSave={async (ssl: DomainConfig["ssl"]) => { setSubmitting(true); setError(undefined); try { const result = await createConfigVersion(domainId, { config: { ...config, ssl }, changeSummary: t("domains:ssl.changeSummary") }, editableVersion.snapshotChecksum); toast.success(t("domains:ssl.draftSaved", { n: result.version.versionNumber })); await query.refresh(); } catch (caught) { setError(formatErrorMessage(t, caught, "domains:ssl.saveFailed")); } finally { setSubmitting(false); } }} onCreateOrder={async () => { setSubmitting(true); setError(undefined); try { const result = await createCertificateOrder(domainId, { accountEmail: config.ssl.email, environment: config.ssl.environment, validation: config.ssl.validation }); await router.push(localizePath(`/domains/ssl?id=${domainId}&orderId=${result.order.id}`, locale)); } catch (caught) { setError(formatErrorMessage(t, caught, "domains:ssl.orderCreateFailed")); setSubmitting(false); } }} /> : <Skeleton className="h-96" />}</div>
      <div className="flex flex-col gap-5"><Card className="border border-border"><CardHeader><CardTitle>{t("domains:ssl.ordersCard.title")}</CardTitle><CardDescription>{t("domains:ssl.ordersCard.description")}</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{data?.orders?.length ? data.orders.slice(0, 5).map((order) => <LocalizedLink className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/40" href={`/domains/ssl?id=${domainId}&orderId=${order.id}`} key={order.id}><span className="text-sm">{order.replacesCertificateId ? t("domains:ssl.ordersCard.renewal") : t("domains:ssl.ordersCard.apply")} · {order.validationMethod} · {order.environment}</span><StatusBadge status={order.status} /></LocalizedLink>) : <p className="text-sm text-muted-foreground">{t("domains:ssl.ordersCard.empty")}</p>}</CardContent></Card><Card className="border border-border"><CardHeader><CardTitle>{t("domains:ssl.certsCard.title")}</CardTitle><CardDescription>{t("domains:ssl.certsCard.description")}</CardDescription></CardHeader><CardContent>{data?.certificates?.length ? data.certificates.map((certificate) => <div className="flex items-start justify-between gap-3 border-b border-border py-3 last:border-0" key={certificate.id}><div className="min-w-0"><p className="truncate text-sm">{certificate.sans.join(", ")}</p><p className="mt-1 text-xs text-muted-foreground">{certificate.notAfter ? t("domains:ssl.certsCard.expireOn", { date: dateFormatter.format(certificate.notAfter) }) : t("domains:ssl.certsCard.unknownExpiry")} · Auto Renew {certificate.autoRenew ? "On" : "Off"}{certificate.nextCheckAt ? ` · ${t("domains:ssl.certsCard.nextCheck", { date: dateFormatter.format(certificate.nextCheckAt) })}` : ""}{certificate.lastErrorCode ? ` · ${certificate.lastErrorCode}` : ""}</p></div><div className="flex shrink-0 items-center gap-2"><StatusBadge status={certificate.status} />{certificate.status === "active" ? <Button size="sm" variant="outline" disabled={Boolean(activeOrder) || submitting} onClick={() => { setSubmitting(true); setError(undefined); void renewCertificate(domainId).then((result) => router.push(localizePath(`/domains/ssl?id=${domainId}&orderId=${result.order.id}`, locale))).catch((caught: Error) => { setError(formatErrorMessage(t, caught, "domains:ssl.orderDetail.operationFailed")); setSubmitting(false); }); }}><RefreshCwIcon />{t("domains:ssl.certsCard.renewNow")}</Button> : null}</div></div>) : <p className="text-sm text-muted-foreground">{t("domains:ssl.certsCard.empty")}</p>}</CardContent></Card></div>
    </div>
  </>;
}

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "domains"]);

export default function DomainSslPage() {
  const router = useRouter();
  const domainId = typeof router.query.id === "string" ? router.query.id : "";
  const orderId = typeof router.query.orderId === "string" ? router.query.orderId : "";
  if (!router.isReady || !domainId) return <Page className="px-0 pb-16"><Skeleton className="m-8 h-96" /></Page>;
  return <Page className="px-0 pb-16"><DomainSsl domainId={domainId} orderId={orderId} /></Page>;
}
