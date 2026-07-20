import * as React from "react";
import Link from "next/link";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/pages/settings/settings-tabs";
import { LogSettingsForm } from "@/components/pages/settings/forms/log-settings-form";
import { RuntimeDiagnosticsForm } from "@/components/pages/settings/forms/runtime-diagnostics-form";
import { SecuritySettingsForm } from "@/components/pages/settings/forms/security-settings-form";
import { NginxSettingsForm } from "@/components/pages/settings/forms/nginx-settings-form";
import { CloudflareCredentialCard, CreateCloudflareCredentialForm } from "@/components/pages/settings/forms/cloudflare-credential-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { createCloudflareCredential, deleteCloudflareCredential, getCloudflareCredentials, getLogSettings, getNginxSettings, getRuntimeDiagnostics, replaceCloudflareCredentialToken } from "@/lib/api";
import { toast } from "sonner";

const SETTINGS_TABS = ["nginx", "security", "cloudflare", "logs", "diagnostics"] as const;

export async function getStaticPaths() {
  return {
    paths: SETTINGS_TABS.map((tab) => ({ params: { tab } })),
    fallback: false,
  };
}

export async function getStaticProps({ params }: { params: { tab: string } }) {
  return { props: { tab: params.tab } };
}

function LogSettingsPage() {
  const query = useApiQuery(getLogSettings);
  return (
    <>
      <PageHeader title="Log Settings" description="配置实例级结构化日志字段、error level 和安全轮动策略。" breadcrumbs={[{ label: "Settings", href: "/settings/nginx" }, { label: "Logs" }]} />
      <SettingsTabs active="logs" />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>日志设置加载失败</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert> : null}
        {query.data?.pendingDeploymentId ? <Alert><AlertTitle>日志设置正在应用</AlertTitle><AlertDescription><Link className="underline underline-offset-4" href={`/deployments/detail?id=${query.data.pendingDeploymentId}`}>查看 Deployment</Link></AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-[640px]" /> : query.data ? <LogSettingsForm key={query.data.active.revision} active={query.data.active} preview={query.data.preview} logRootConfigured={query.data.logRootConfigured} /> : null}
      </div>
    </>
  );
}

function DiagnosticsPage() {
  const query = useApiQuery(getRuntimeDiagnostics);
  return (
    <>
      <PageHeader title="Diagnostics" description="检查 Active revision 与 SQLite 运行投影的一致性。" breadcrumbs={[{ label: "Settings", href: "/settings/nginx" }, { label: "Diagnostics" }]} />
      <SettingsTabs active="diagnostics" />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>Diagnostics 加载失败</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-[520px]" /> : query.data ? <RuntimeDiagnosticsForm diagnostics={query.data} /> : null}
      </div>
    </>
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
  return (
    <>
      <PageHeader title="Cloudflare DNS" description="管理 DNS-01 自动验证使用的最小权限 API Token。" breadcrumbs={[{ label: "Settings", href: "/settings/nginx" }, { label: "Cloudflare DNS" }]} />
      <SettingsTabs active="cloudflare" />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 md:px-8">
        {error || query.error ? <Alert variant="destructive"><AlertTitle>Cloudflare 凭据操作失败</AlertTitle><AlertDescription>{error ?? query.error?.message}</AlertDescription></Alert> : null}
        <CreateCloudflareCredentialForm submitting={submittingId === "new"} onSubmit={(input) => run("new", () => createCloudflareCredential(input), "Cloudflare 凭据已保存")} />
        {query.loading && !query.data ? <Skeleton className="h-56" /> : query.data?.items.map((credential) => <CloudflareCredentialCard key={credential.id} credential={credential} submitting={submittingId === credential.id} onReplace={(token) => run(credential.id, () => replaceCloudflareCredentialToken(credential.id, token), "Token 已替换")} onDelete={() => run(credential.id, () => deleteCloudflareCredential(credential.id), "凭据已删除")} />)}
      </div>
    </>
  );
}

function SecuritySettingsPage() {
  return (
    <>
      <PageHeader title="Security" description="管理管理员密码与已登录会话。" breadcrumbs={[{ label: "Settings", href: "/settings/nginx" }, { label: "Security" }]} />
      <SettingsTabs active="security" />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        <SecuritySettingsForm />
      </div>
    </>
  );
}

function NginxSettingsPage() {
  const query = useApiQuery(getNginxSettings);
  return (
    <>
      <PageHeader title="Nginx" description="查看运行路径、健康状态并管理 runtime artifacts 容量。" breadcrumbs={[{ label: "Settings", href: "/settings/nginx" }, { label: "Nginx" }]} />
      <SettingsTabs active="nginx" />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>Nginx 设置加载失败</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-[620px]" /> : query.data ? <NginxSettingsForm settings={query.data} onSaved={query.refresh} /> : null}
      </div>
    </>
  );
}

export default function SettingsTabPage({ tab }: { tab: string }) {
  const content = tab === "logs" ? <LogSettingsPage />
    : tab === "diagnostics" ? <DiagnosticsPage />
    : tab === "cloudflare" ? <CloudflareSettingsPage />
    : tab === "security" ? <SecuritySettingsPage />
    : tab === "nginx" ? <NginxSettingsPage />
    : null;
  return <Page className="px-0 pb-16">{content}</Page>;
}
