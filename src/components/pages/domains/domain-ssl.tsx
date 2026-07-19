import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ArrowLeftIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { ApiError, createCertificateOrder, createConfigVersion, getCertificateOrder, getCloudflareCredentials, getDomain, getDomainCertificateOrders, getDomainCertificates, recheckCertificateOrder, renewCertificate, retryCertificateActivation, retryCloudflareCleanup } from "@/lib/api";
import type { DomainConfig } from "@/shared/schemas";
import { DomainTabs } from "./domain-tabs";
import { SslSettingsForm } from "./forms/ssl-form";

function idsFromPath(asPath: string) {
  const match = asPath.match(/^\/domains\/([^/?]+)\/ssl(?:\/orders\/([^/?]+))?/);
  return { domainId: match?.[1] ? decodeURIComponent(match[1]) : "", orderId: match?.[2] ? decodeURIComponent(match[2]) : "" };
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const terminalOrders = ["succeeded", "failed", "expired", "cancelled"];

export function DomainSsl() {
  const router = useRouter();
  const ids = idsFromPath(router.asPath);
  const load = React.useCallback(async () => {
    const domain = await getDomain(ids.domainId);
    if (ids.orderId) return { domain, order: await getCertificateOrder(ids.domainId, ids.orderId), orders: null, certificates: null, credentials: null };
    const [orders, certificates, credentials] = await Promise.all([getDomainCertificateOrders(ids.domainId), getDomainCertificates(ids.domainId), getCloudflareCredentials()]);
    return { domain, order: null, orders: orders.items, certificates: certificates.items, credentials: credentials.items.filter((credential) => credential.status === "active") };
  }, [ids.domainId, ids.orderId]);
  const query = useApiQuery(load);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    const detail = query.data?.order;
    if (!ids.orderId || !detail) return;
    const activationRunning = detail.order.status === "succeeded" && (!detail.activation || detail.activation.status === "pending" || ["queued", "running"].includes(detail.deployment?.status ?? ""));
    if (terminalOrders.includes(detail.order.status) && !activationRunning) return;
    const timer = window.setInterval(() => void query.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [ids.orderId, query]);

  if (!router.isReady || !ids.domainId) return <Skeleton className="m-8 h-96" />;
  const data = query.data;
  const config = data?.domain.config;
  const editableVersion = data?.domain.draftVersion ?? data?.domain.activeVersion;
  const activeOrder = data?.orders?.find((order) => !terminalOrders.includes(order.status));
  const activeCertificate = data?.certificates?.find((certificate) => certificate.status === "active");

  if (ids.orderId) {
    const detail = data?.order;
    return <>
      <PageHeader title={detail ? `${detail.order.replacesCertificateId ? "证书续期" : "证书订单"} ${detail.order.id.slice(0, 8)}` : "证书订单"} description="订单状态来自服务端持久化状态机，页面不会自行推断 ACME 结果。" breadcrumbs={[{ label: "Domains", href: "/domains" }, { label: data?.domain.domain.primaryHostname ?? "Domain", href: `/domains/${ids.domainId}/overview` }, { label: "SSL", href: `/domains/${ids.domainId}/ssl` }, { label: "Order" }]} action={<Button size="sm" variant="outline" asChild><Link href={`/domains/${ids.domainId}/ssl`}><ArrowLeftIcon />返回 SSL</Link></Button>} />
      <DomainTabs domainId={ids.domainId} active="ssl" />
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>订单加载失败</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert> : null}
        {!detail ? <Skeleton className="h-80" /> : <><Card className="border border-border"><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>Order 状态</CardTitle><StatusBadge status={detail.order.status} /></div><CardDescription>{detail.order.environment} · {detail.order.validationMethod}{detail.order.dnsProvider ? ` / ${detail.order.dnsProvider}` : ""}</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Identifiers</p><p className="mt-1 text-sm">{detail.order.identifiers.join(", ")}</p></div><div><p className="text-xs text-muted-foreground">创建时间</p><p className="mt-1 text-sm">{dateFormatter.format(detail.order.createdAt)}</p></div></CardContent></Card>{detail.order.errorMessage && detail.order.status !== "succeeded" ? <Alert variant="destructive"><AlertTitle>订单处理失败</AlertTitle><AlertDescription>{detail.order.errorMessage}</AlertDescription></Alert> : null}{detail.order.cleanupStatus === "failed" ? <Alert><AlertTitle>Cloudflare TXT 清理失败</AlertTitle><AlertDescription className="flex items-center justify-between gap-3"><span>{detail.order.errorMessage ?? "证书结果不受影响，系统会继续自动重试。"}</span><Button size="sm" variant="outline" onClick={() => { void retryCloudflareCleanup(ids.domainId, ids.orderId).then(() => query.refresh()).catch((caught: Error) => setError(caught.message)); }}><RefreshCwIcon />重试清理</Button></AlertDescription></Alert> : null}{detail.order.status === "preparing" ? <Alert><ShieldCheckIcon /><AlertTitle>正在准备 ACME Order</AlertTitle><AlertDescription>账户和订单密钥已持久化；服务端正在向 CA 获取真实 Challenge。</AlertDescription></Alert> : null}{detail.challenges.length ? <Card className="border border-border"><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>Challenges</CardTitle><CardDescription>{detail.order.validationMethod === "dns-01" ? "为每个 hostname 添加对应 TXT；不要覆盖同名的其他记录。" : "HTTP token 已由系统公开端点提供。"}</CardDescription></div>{["waiting_http", "waiting_dns", "validating"].includes(detail.order.status) ? <Button size="sm" variant="outline" onClick={() => { void recheckCertificateOrder(ids.domainId, ids.orderId).then((result) => { toast.success(result.debounced ? "刚刚已请求检查" : "已安排立即检查"); return query.refresh(); }).catch((caught: Error) => setError(caught.message)); }}><RefreshCwIcon />重新校验</Button> : null}</div></CardHeader><CardContent className="flex flex-col gap-3">{detail.challenges.map((challenge) => <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-[minmax(0,1fr)_auto]" key={challenge.id}><div><p className="font-medium">{challenge.hostname}</p>{challenge.dnsRecordName ? <><p className="mt-2 font-mono text-xs">{challenge.dnsRecordName}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{challenge.dnsRecordValue}</p></> : <p className="mt-1 text-sm text-muted-foreground">/.well-known/acme-challenge/ 已就绪</p>}</div><StatusBadge status={challenge.status} /></div>)}</CardContent></Card> : null}{detail.certificate ? <Card className="border border-border"><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>证书激活</CardTitle><CardDescription>签发已完成；配置版本和发布结果不会回写 ACME Order。</CardDescription></div><StatusBadge status={detail.deployment?.status ?? detail.activation?.status ?? detail.certificate.status} /></div></CardHeader><CardContent className="flex flex-col gap-3"><div className="grid gap-3 text-sm sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Certificate</p><p className="mt-1 font-mono">{detail.certificate.id.slice(0, 8)}</p></div><div><p className="text-xs text-muted-foreground">Config Version</p><p className="mt-1 font-mono">{detail.activation?.configVersionId?.slice(0, 8) ?? "等待创建"}</p></div></div>{detail.deployment ? <Button variant="outline" asChild><Link href={`/deployments/${detail.deployment.id}`}>查看 Deployment · {detail.deployment.status}</Link></Button> : null}{detail.activation?.errorMessage || detail.deployment?.errorMessage ? <Alert variant="destructive"><AlertTitle>证书激活失败</AlertTitle><AlertDescription>{detail.activation?.errorMessage ?? detail.deployment?.errorMessage}</AlertDescription></Alert> : null}{detail.activation?.status === "failed" || detail.deployment?.status === "failed" ? <Button onClick={() => { setError(undefined); void retryCertificateActivation(ids.domainId, ids.orderId).then(() => { toast.success("已重新安排证书激活"); return query.refresh(); }).catch((caught: Error) => setError(caught.message)); }}><RefreshCwIcon />重试激活</Button> : null}</CardContent></Card> : null}{error ? <Alert variant="destructive"><AlertTitle>订单操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}</>}
      </div>
    </>;
  }

  return <>
    <PageHeader title={data ? <span className="flex items-center gap-3">{data.domain.domain.primaryHostname}<StatusBadge status={config?.ssl.certificateId ? "active" : config?.ssl.enabled ? "pending" : "disabled"} /></span> : "SSL"} description="配置 HTTPS、申请证书并跟踪独立的签发与激活流程。" breadcrumbs={[{ label: "Domains", href: "/domains" }, { label: data?.domain.domain.primaryHostname ?? "Domain", href: `/domains/${ids.domainId}/overview` }, { label: "SSL" }]} action={<Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}><RefreshCwIcon className={query.refreshing ? "animate-spin" : undefined} />刷新</Button>} />
    <DomainTabs domainId={ids.domainId} active="ssl" />
    <div className="mx-auto grid w-full max-w-[1440px] gap-5 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_380px] md:px-8">
      <div>{error || query.error ? <Alert className="mb-5" variant="destructive"><AlertTitle>SSL 操作失败</AlertTitle><AlertDescription>{error ?? query.error?.message}</AlertDescription></Alert> : null}{activeCertificate && data && !data.domain.domain.enabled ? <Alert className="mb-5"><AlertTitle>Active · Domain Disabled / not serving</AlertTitle><AlertDescription>证书仍被 503 runtime server 引用，但当前不提供业务服务。Auto Renew 会继续运行并可能消耗 CA 配额；如需停止，请关闭 Auto Renew 并发布设置。</AlertDescription></Alert> : null}{config && editableVersion ? <SslSettingsForm key={editableVersion.snapshotChecksum} initial={config.ssl} credentials={data.credentials ?? []} certificateActive={Boolean(activeCertificate)} submitting={submitting} orderRunning={Boolean(activeOrder)} onSave={async (ssl: DomainConfig["ssl"]) => { setSubmitting(true); setError(undefined); try { const result = await createConfigVersion(ids.domainId, { config: { ...config, ssl }, changeSummary: "更新 HTTPS 设置" }, editableVersion.snapshotChecksum); toast.success(`已保存 v${result.version.versionNumber} 草稿`); await query.refresh(); } catch (caught) { setError(caught instanceof ApiError ? caught.message : "SSL 设置保存失败"); } finally { setSubmitting(false); } }} onCreateOrder={async () => { setSubmitting(true); setError(undefined); try { const result = await createCertificateOrder(ids.domainId, { accountEmail: config.ssl.email, environment: config.ssl.environment, validation: config.ssl.validation }); await router.push(`/domains/${ids.domainId}/ssl/orders/${result.order.id}`); } catch (caught) { setError(caught instanceof Error ? caught.message : "证书订单创建失败"); setSubmitting(false); } }} /> : <Skeleton className="h-96" />}</div>
      <div className="flex flex-col gap-5"><Card className="border border-border"><CardHeader><CardTitle>最近订单</CardTitle><CardDescription>签发状态与配置发布相互独立。</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{data?.orders?.length ? data.orders.slice(0, 5).map((order) => <Link className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/40" href={`/domains/${ids.domainId}/ssl/orders/${order.id}`} key={order.id}><span className="text-sm">{order.replacesCertificateId ? "续期" : "申请"} · {order.validationMethod} · {order.environment}</span><StatusBadge status={order.status} /></Link>) : <p className="text-sm text-muted-foreground">尚无证书订单。</p>}</CardContent></Card><Card className="border border-border"><CardHeader><CardTitle>证书资产</CardTitle><CardDescription>Active 证书会在到期前 30 天自动进入续期。</CardDescription></CardHeader><CardContent>{data?.certificates?.length ? data.certificates.map((certificate) => <div className="flex items-start justify-between gap-3 border-b border-border py-3 last:border-0" key={certificate.id}><div className="min-w-0"><p className="truncate text-sm">{certificate.sans.join(", ")}</p><p className="mt-1 text-xs text-muted-foreground">{certificate.notAfter ? `到期 ${dateFormatter.format(certificate.notAfter)}` : "有效期未知"} · Auto Renew {certificate.autoRenew ? "On" : "Off"}{certificate.nextCheckAt ? ` · 下次检查 ${dateFormatter.format(certificate.nextCheckAt)}` : ""}{certificate.lastErrorCode ? ` · ${certificate.lastErrorCode}` : ""}</p></div><div className="flex shrink-0 items-center gap-2"><StatusBadge status={certificate.status} />{certificate.status === "active" ? <Button size="sm" variant="outline" disabled={Boolean(activeOrder) || submitting} onClick={() => { setSubmitting(true); setError(undefined); void renewCertificate(ids.domainId).then((result) => router.push(`/domains/${ids.domainId}/ssl/orders/${result.order.id}`)).catch((caught: Error) => { setError(caught.message); setSubmitting(false); }); }}><RefreshCwIcon />立即续期</Button> : null}</div></div>) : <p className="text-sm text-muted-foreground">尚无已下载证书。</p>}</CardContent></Card></div>
    </div>
  </>;
}
