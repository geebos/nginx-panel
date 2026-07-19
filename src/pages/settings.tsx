import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { LogSettingsForm } from "@/components/pages/settings/forms/log-settings-form";
import { RuntimeDiagnosticsForm } from "@/components/pages/settings/forms/runtime-diagnostics-form";
import { SecuritySettingsForm } from "@/components/pages/settings/forms/security-settings-form";
import { NginxSettingsForm } from "@/components/pages/settings/forms/nginx-settings-form";
import { CloudflareCredentialCard, CreateCloudflareCredentialForm } from "@/components/pages/settings/forms/cloudflare-credential-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { createCloudflareCredential, deleteCloudflareCredential, getCloudflareCredentials, getLogSettings, getNginxSettings, getRuntimeDiagnostics, replaceCloudflareCredentialToken } from "@/lib/api";
import { toast } from "sonner";

function LogSettingsPage() {
  const query = useApiQuery(getLogSettings);
  return (
    <Page className="px-0 pb-16">
      <PageHeader title="Log Settings" description="配置实例级结构化日志字段、error level 和安全轮动策略。" breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }, { label: "Logs" }]} action={<Button asChild size="sm" variant="outline"><Link href="/settings/diagnostics">Diagnostics</Link></Button>} />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>日志设置加载失败</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert> : null}
        {query.data?.pendingDeploymentId ? <Alert><AlertTitle>日志设置正在应用</AlertTitle><AlertDescription><Link className="underline underline-offset-4" href={`/deployments/${query.data.pendingDeploymentId}`}>查看 Deployment</Link></AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-[640px]" /> : query.data ? <LogSettingsForm key={query.data.active.revision} active={query.data.active} preview={query.data.preview} logRootConfigured={query.data.logRootConfigured} /> : null}
      </div>
    </Page>
  );
}

function DiagnosticsPage() {
  const query = useApiQuery(getRuntimeDiagnostics);
  return (
    <Page className="px-0 pb-16">
      <PageHeader title="Diagnostics" description="检查 Active revision 与 SQLite 运行投影的一致性。" breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }, { label: "Diagnostics" }]} action={<Button asChild size="sm" variant="outline"><Link href="/settings/logs">Log Settings</Link></Button>} />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>Diagnostics 加载失败</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-[520px]" /> : query.data ? <RuntimeDiagnosticsForm diagnostics={query.data} /> : null}
      </div>
    </Page>
  );
}

function CloudflareSettingsPage() {
  const query = useApiQuery(getCloudflareCredentials);
  const [submittingId, setSubmittingId] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const run = async (id: string, action: () => Promise<unknown>, message: string) => {
    setSubmittingId(id); setError(undefined);
    try { await action(); toast.success(message); await query.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Cloudflare 凭据操作失败"); throw caught; }
    finally { setSubmittingId(undefined); }
  };
  return <Page className="px-0 pb-16">
    <PageHeader title="Cloudflare DNS" description="管理 DNS-01 自动验证使用的最小权限 API Token。" breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }, { label: "Cloudflare DNS" }]} action={<Button asChild size="sm" variant="outline"><Link href="/settings/logs">Log Settings</Link></Button>} />
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 md:px-8">
      {error || query.error ? <Alert variant="destructive"><AlertTitle>Cloudflare 凭据操作失败</AlertTitle><AlertDescription>{error ?? query.error?.message}</AlertDescription></Alert> : null}
      <CreateCloudflareCredentialForm submitting={submittingId === "new"} onSubmit={(input) => run("new", () => createCloudflareCredential(input), "Cloudflare 凭据已保存")} />
      {query.loading && !query.data ? <Skeleton className="h-56" /> : query.data?.items.map((credential) => <CloudflareCredentialCard key={credential.id} credential={credential} submitting={submittingId === credential.id} onReplace={(token) => run(credential.id, () => replaceCloudflareCredentialToken(credential.id, token), "Token 已替换")} onDelete={() => run(credential.id, () => deleteCloudflareCredential(credential.id), "凭据已删除")} />)}
    </div>
  </Page>;
}

function SecuritySettingsPage() {
  return (
    <Page className="px-0 pb-16">
      <PageHeader title="Security" description="管理管理员密码与已登录会话。" breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }, { label: "Security" }]} action={<Button asChild size="sm" variant="outline"><Link href="/settings/diagnostics">Diagnostics</Link></Button>} />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        <SecuritySettingsForm />
      </div>
    </Page>
  );
}

function NginxSettingsPage() {
  const query = useApiQuery(getNginxSettings);
  return (
    <Page className="px-0 pb-16">
      <PageHeader title="Nginx" description="查看运行路径、健康状态并管理 runtime artifacts 容量。" breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }, { label: "Nginx" }]} action={<Button asChild size="sm" variant="outline"><Link href="/settings/diagnostics">Diagnostics</Link></Button>} />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>Nginx 设置加载失败</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-[620px]" /> : query.data ? <NginxSettingsForm settings={query.data} onSaved={query.refresh} /> : null}
      </div>
    </Page>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const path = router.asPath.split("?")[0].replace(/\/$/, "");
  if (path === "/settings/logs") return <LogSettingsPage />;
  if (path === "/settings/diagnostics") return <DiagnosticsPage />;
  if (path === "/settings/cloudflare") return <CloudflareSettingsPage />;
  if (path === "/settings/security") return <SecuritySettingsPage />;
  if (path === "/settings/nginx") return <NginxSettingsPage />;
  return (
    <Page className="px-0 pb-16">
      <PageHeader title="Settings" description="该设置分类将在后续阶段接入。" breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }]} />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        <Empty><EmptyHeader><EmptyTitle>选择设置分类</EmptyTitle><EmptyDescription>配置 Nginx、Cloudflare DNS、日志、安全策略或运行时诊断。</EmptyDescription></EmptyHeader><EmptyContent className="flex flex-wrap gap-2"><Button asChild><Link href="/settings/nginx">Nginx</Link></Button><Button asChild variant="outline"><Link href="/settings/security">Security</Link></Button><Button asChild variant="outline"><Link href="/settings/cloudflare">Cloudflare DNS</Link></Button><Button asChild variant="outline"><Link href="/settings/logs">Log Settings</Link></Button></EmptyContent></Empty>
      </div>
    </Page>
  );
}
