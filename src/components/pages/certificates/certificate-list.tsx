import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { RefreshCwIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
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

const DAY = 24 * 60 * 60 * 1000;
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" });

type DisplayStatus = "ready" | "active" | "expiring" | "expired" | "failed" | "superseded";

function displayStatus(certificate: CertificateSummary, now: number): DisplayStatus {
  if (certificate.status === "failed") return "failed";
  if (certificate.notAfter && certificate.notAfter <= now) return "expired";
  if (certificate.status === "active" && certificate.notAfter && certificate.notAfter - now <= 30 * DAY) return "expiring";
  return certificate.status as DisplayStatus;
}

function CertificateStatus({ certificate, now }: { certificate: CertificateSummary; now: number }) {
  const status = displayStatus(certificate, now);
  if (status === "active" && !certificate.domainEnabled) {
    return <Badge variant="outline">Active, Domain Disabled</Badge>;
  }
  return <StatusBadge status={status} />;
}

export function CertificateList() {
  const router = useRouter();
  const query = useApiQuery(React.useCallback(() => getCertificates(), []));
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [autoRenewOnly, setAutoRenewOnly] = React.useState(false);
  const [renewingId, setRenewingId] = React.useState<string>();
  const [now] = React.useState(() => Date.now());
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
      toast.success("续期订单已创建");
      await router.push(`/domains/${certificate.domainId}/ssl/orders/${result.order.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "续期订单创建失败");
      setRenewingId(undefined);
    }
  };

  return <>
    <PageHeader
      title="Certificates"
      description="查看证书有效期、自动续期状态和关联的 Domain 配置。"
      breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Certificates" }]}
      action={<Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}><RefreshCwIcon className={query.refreshing ? "animate-spin" : undefined} />刷新</Button>}
    />
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 md:px-8">
      {query.error ? <Alert variant="destructive"><AlertTitle>证书加载失败</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert> : null}

      {query.loading ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <Skeleton className="h-24" key={index} />)}</div> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Object.entries(summary).map(([key, value]) => <Card className="border border-border shadow-none" key={key}><CardHeader className="pb-2"><CardTitle className="text-sm font-normal capitalize text-muted-foreground">{key}</CardTitle></CardHeader><CardContent className="font-mono text-2xl">{value}</CardContent></Card>)}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
        <label className="relative"><span className="mb-2 block text-sm font-medium">搜索 Domain / SAN</span><SearchIcon className="pointer-events-none absolute bottom-2.5 left-3 size-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="example.com" /></label>
        <label><span className="mb-2 block text-sm font-medium">状态</span><Select value={status} onChange={(value) => setStatus(value ?? "all")} options={[{ value: "all", label: "全部状态" }, { value: "ready", label: "Ready" }, { value: "active", label: "Active" }, { value: "expiring", label: "Expiring" }, { value: "expired", label: "Expired" }, { value: "failed", label: "Failed" }, { value: "superseded", label: "Superseded" }]} /></label>
        <label className="flex h-10 items-center gap-3 rounded-md border border-border px-3 text-sm"><Switch checked={autoRenewOnly} onCheckedChange={setAutoRenewOnly} />仅自动续期</label>
      </div>

      {!query.loading && !items.length ? <Empty className="border border-dashed"><EmptyHeader><EmptyMedia variant="icon"><ShieldCheckIcon /></EmptyMedia><EmptyTitle>尚无证书</EmptyTitle><EmptyDescription>进入 Domain 的 SSL 页面启用 HTTPS 并创建证书订单。</EmptyDescription></EmptyHeader><Button asChild><Link href="/domains">查看 Domains</Link></Button></Empty> : null}
      {!query.loading && items.length && !filtered.length ? <Empty className="border border-dashed"><EmptyHeader><EmptyTitle>没有匹配的证书</EmptyTitle><EmptyDescription>调整搜索词、状态或自动续期筛选。</EmptyDescription></EmptyHeader></Empty> : null}

      {filtered.length ? <>
        <div className="hidden overflow-hidden rounded-lg border border-border md:block">
          <Table><TableHeader><TableRow><TableHead>Primary Domain</TableHead><TableHead>SAN</TableHead><TableHead>Provider</TableHead><TableHead>Expires</TableHead><TableHead>Auto Renew</TableHead><TableHead>Status</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{filtered.map((certificate) => <TableRow key={certificate.id}><TableCell><Link className="font-medium hover:underline" href={`/domains/${certificate.domainId}/ssl`}>{certificate.primaryHostname}</Link>{!certificate.domainEnabled ? <p className="mt-1 text-xs text-muted-foreground">业务请求当前返回 503</p> : null}</TableCell><TableCell className="max-w-72 truncate text-sm text-muted-foreground">{certificate.sans.join(", ")}</TableCell><TableCell>{certificate.provider}</TableCell><TableCell>{certificate.notAfter ? dateFormatter.format(certificate.notAfter) : "未知"}</TableCell><TableCell>{certificate.autoRenew ? "On" : "Off"}</TableCell><TableCell><CertificateStatus certificate={certificate} now={now} /></TableCell><TableCell><div className="flex justify-end gap-2"><Button size="sm" variant="outline" asChild><Link href={`/domains/${certificate.domainId}/ssl/orders/${certificate.acmeOrderId}`}>来源 Order</Link></Button><Button size="sm" variant="outline" asChild><Link href={`/domains/${certificate.domainId}/ssl`}>管理</Link></Button>{certificate.status === "active" ? <Button size="sm" disabled={Boolean(renewingId)} onClick={() => void renew(certificate)}>{renewingId === certificate.id ? <RefreshCwIcon className="animate-spin" /> : null}续期</Button> : null}</div></TableCell></TableRow>)}</TableBody></Table>
        </div>
        <div className="grid gap-3 md:hidden">{filtered.map((certificate) => <Card className="border border-border shadow-none" key={certificate.id}><CardHeader><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate text-base">{certificate.primaryHostname}</CardTitle><p className="mt-1 truncate text-xs text-muted-foreground">{certificate.sans.join(", ")}</p></div><CertificateStatus certificate={certificate} now={now} /></div></CardHeader><CardContent className="flex flex-col gap-4"><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Expires</dt><dd className="mt-1">{certificate.notAfter ? dateFormatter.format(certificate.notAfter) : "未知"}</dd></div><div><dt className="text-xs text-muted-foreground">Auto Renew</dt><dd className="mt-1">{certificate.autoRenew ? "On" : "Off"}</dd></div></dl><div className="grid grid-cols-2 gap-2"><Button variant="outline" asChild><Link href={`/domains/${certificate.domainId}/ssl/orders/${certificate.acmeOrderId}`}>来源 Order</Link></Button><Button asChild><Link href={`/domains/${certificate.domainId}/ssl`}>管理</Link></Button></div></CardContent></Card>)}</div>
      </> : null}
    </div>
  </>;
}
