import * as React from "react";
import { useRouter } from "next/router";
import { ActivityIcon, AlertTriangleIcon, ServerCogIcon, ShieldCheckIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActiveRuntimeConfig, getDomains, rebuildActiveRuntime, reloadManagerTls, runDiagnosticNginxTest, type ActiveRuntimeConfig, type RuntimeDiagnostics } from "@/lib/api";
import { useApiQuery } from "@/hooks/use-api-query";

function formatBytes(value: number | null) {
  if (value === null) return "N/A";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

export function RuntimeDiagnosticsForm({ diagnostics }: { diagnostics: RuntimeDiagnostics }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [reloadingTls, setReloadingTls] = React.useState(false);
  const [testingNginx, setTestingNginx] = React.useState(false);
  const [domainId, setDomainId] = React.useState("");
  const [runtimeConfig, setRuntimeConfig] = React.useState<ActiveRuntimeConfig>();
  const [runtimeConfigError, setRuntimeConfigError] = React.useState<string>();
  const [loadingRuntimeConfig, setLoadingRuntimeConfig] = React.useState(false);
  const loadDomains = React.useCallback(() => getDomains(new URLSearchParams({ page: "1", pageSize: "100", status: "all", sort: "hostname_asc" })), []);
  const domains = useApiQuery(loadDomains);

  const rebuild = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      const result = await rebuildActiveRuntime(currentPassword);
      await router.push(`/deployments/detail?id=${result.deploymentId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "运行配置重建失败");
      setSubmitting(false);
    }
  };

  const reloadTls = async () => {
    setError(undefined);
    setReloadingTls(true);
    try {
      const result = await reloadManagerTls();
      await router.push(`/deployments/detail?id=${result.deploymentId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "管理端 TLS 重新加载失败");
      setReloadingTls(false);
    }
  };

  const testNginx = async () => {
    setError(undefined);
    setTestingNginx(true);
    try {
      const result = await runDiagnosticNginxTest();
      await router.push(`/deployments/detail?id=${result.deploymentId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nginx 配置测试失败");
      setTestingNginx(false);
    }
  };

  const inspectRuntimeConfig = async (nextDomainId: string | null) => {
    const next = nextDomainId ?? "";
    setDomainId(next);
    setRuntimeConfig(undefined);
    setRuntimeConfigError(undefined);
    if (!next) return;
    setLoadingRuntimeConfig(true);
    try {
      setRuntimeConfig(await getActiveRuntimeConfig(next));
    } catch (caught) {
      setRuntimeConfigError(caught instanceof Error ? caught.message : "Active Domain 配置加载失败");
    } finally {
      setLoadingRuntimeConfig(false);
    }
  };

  const runtime = diagnostics.runtime;
  return (
    <form className="flex flex-col gap-6" onSubmit={rebuild}>
      {error ? <Alert variant="destructive"><AlertTitle>Diagnostics 操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      <Card className="border border-border">
        <CardHeader>
          <CardTitle>Runtime consistency</CardTitle>
          <CardDescription>启动时对 SQLite 投影、manifest、配置文件集合、checksum 和 nginx -t 进行一致性校验。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={runtime.status === "healthy" ? "secondary" : "destructive"}>{runtime.status}</Badge>
            <span className="font-mono text-xs text-muted-foreground">revision {runtime.activeRevision ?? "bootstrap"}</span>
          </div>
          {runtime.issues.length ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>检测到运行配置漂移</AlertTitle>
              <AlertDescription>
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {runtime.issues.map((issue) => <li key={issue.code}>{issue.message}（{issue.code}）</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          ) : <p className="text-sm text-muted-foreground">当前 Active revision 与数据库来源一致。</p>}
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-3">
          <span className="text-xs text-muted-foreground">Worker PID {diagnostics.worker.pid}，已运行 {Math.floor(diagnostics.worker.uptimeSeconds / 60)} 分钟</span>
          <Button type="button" variant="outline" disabled={testingNginx} onClick={() => void testNginx()}>
            {testingNginx ? <Spinner data-icon="inline-start" /> : <ActivityIcon data-icon="inline-start" />}
            运行 nginx -t
          </Button>
        </CardFooter>
      </Card>

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>存储与挂载</CardTitle>
          <CardDescription>业务路径使用稳定占位符；日志根目录因迁移诊断需要按原值显示。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>区域</TableHead><TableHead>状态</TableHead><TableHead>路径</TableHead><TableHead className="text-right">内容大小</TableHead><TableHead className="text-right">可用空间</TableHead></TableRow></TableHeader>
            <TableBody>
              {diagnostics.storage.map((item) => (
                <TableRow key={item.key}>
                  <TableCell className="font-medium">{item.label}</TableCell>
                  <TableCell><Badge variant={item.status === "available" ? "secondary" : item.status === "unconfigured" ? "outline" : "destructive"}>{item.status}</Badge></TableCell>
                  <TableCell className="max-w-72 truncate font-mono text-xs" title={item.path}>{item.path}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatBytes(item.itemBytes)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatBytes(item.filesystem?.availableBytes ?? null)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {diagnostics.logRoots.historical.length ? (
            <Alert className="mt-4">
              <AlertTriangleIcon />
              <AlertTitle>检测到历史日志根目录</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <p>产品只读取当前日志根目录，不会自动迁移旧日志。请在清理相关 revision 前手动迁移。</p>
                {diagnostics.logRoots.historical.map((root) => <code key={root.path} className="break-all text-xs">{root.path} ({root.readable ? "可读取" : "不可读取"})</code>)}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>Active Domain 配置</CardTitle>
          <CardDescription>读取当前 revision 中的实际 server 文件，并核对 source 与文件 checksum。绝对敏感路径已脱敏。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel>Domain</FieldLabel>
            <Select
              options={(domains.data?.items ?? []).filter((domain) => domain.activeVersionId).map((domain) => ({ value: domain.id, label: domain.primaryHostname, description: domain.activeVersionId ?? undefined }))}
              emptyText="没有已发布的 Domain"
              placeholder={domains.loading ? "正在加载 Domain" : "选择已发布 Domain"}
              value={domainId}
              onChange={(value) => void inspectRuntimeConfig(value)}
            />
            {domains.error ? <FieldDescription>Domain 列表加载失败：{domains.error.message}</FieldDescription> : null}
          </Field>
          {runtimeConfigError ? <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>配置读取失败</AlertTitle><AlertDescription>{runtimeConfigError}</AlertDescription></Alert> : null}
          {loadingRuntimeConfig ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />正在读取 Active revision</div> : null}
          {runtimeConfig ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div><p className="text-xs text-muted-foreground">Revision file</p><p className="break-all font-mono text-xs">{runtimeConfig.file}</p></div>
                <div><p className="text-xs text-muted-foreground">Source version</p><p className="break-all font-mono text-xs">{runtimeConfig.inputs.sourceVersionId}</p></div>
                <div><p className="text-xs text-muted-foreground">Source checksum</p><p className="break-all font-mono text-xs">{runtimeConfig.checksums.source}</p></div>
                <div><p className="text-xs text-muted-foreground">Config checksum</p><p className="break-all font-mono text-xs">{runtimeConfig.checksums.config}</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{runtimeConfig.inputs.routes} routes</Badge>
                <Badge variant="outline">{runtimeConfig.inputs.headers} headers</Badge>
                <Badge variant="outline">logs r{runtimeConfig.inputs.logSettingsRevision}</Badge>
                <Badge variant={runtimeConfig.inputs.enabled ? "secondary" : "outline"}>{runtimeConfig.inputs.enabled ? "enabled" : "disabled"}</Badge>
              </div>
              <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted p-4 font-mono text-xs leading-5"><code>{runtimeConfig.config}</code></pre>
            </div>
          ) : !domainId && !domains.loading ? <p className="text-sm text-muted-foreground">选择一个已发布 Domain 查看当前运行配置。</p> : null}
        </CardContent>
      </Card>

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>管理端 TLS</CardTitle>
          <CardDescription>校验部署方挂载的证书有效期、SAN 与私钥匹配关系，再安全重新加载 Nginx。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={diagnostics.managerTls.status === "valid" ? "secondary" : diagnostics.managerTls.status === "invalid" ? "destructive" : "outline"}>{diagnostics.managerTls.status}</Badge>
            {diagnostics.managerTls.certificate ? <span className="font-mono text-xs text-muted-foreground">有效期至 {new Date(diagnostics.managerTls.certificate.validTo).toLocaleString("zh-CN")}</span> : null}
          </div>
          {diagnostics.managerTls.certificate ? (
            <dl className="grid gap-3 text-sm md:grid-cols-[140px_1fr]">
              <dt className="text-muted-foreground">Hostname</dt><dd className="break-all font-mono">{diagnostics.managerTls.certificate.hostname}</dd>
              <dt className="text-muted-foreground">SAN</dt><dd className="break-all font-mono">{diagnostics.managerTls.certificate.subjectAltName}</dd>
              <dt className="text-muted-foreground">SHA-256</dt><dd className="break-all font-mono">{diagnostics.managerTls.certificate.fingerprint256}</dd>
            </dl>
          ) : diagnostics.managerTls.error ? <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>证书校验失败</AlertTitle><AlertDescription>{diagnostics.managerTls.error}</AlertDescription></Alert> : <p className="text-sm text-muted-foreground">当前运行模式不管理 TLS。</p>}
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="button" variant="outline" disabled={diagnostics.managerTls.status === "unavailable" || reloadingTls} onClick={() => void reloadTls()}>
            {reloadingTls ? <Spinner data-icon="inline-start" /> : <ShieldCheckIcon data-icon="inline-start" />}
            校验并重新加载证书
          </Button>
        </CardFooter>
      </Card>

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>按 SQLite 重建 Active revision</CardTitle>
          <CardDescription>只在 degraded 状态可用。重建不会创建 Config Version，也不会改变任何 Domain 的 Active Version。</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-disabled={!diagnostics.rebuildAvailable || submitting || undefined}>
              <FieldLabel htmlFor="rebuild-current-password">当前管理员密码</FieldLabel>
              <Input id="rebuild-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={!diagnostics.rebuildAvailable || submitting} />
              <FieldDescription>确认后将从受信任的 SQLite 快照全量生成 candidate，并执行 nginx -t、原子激活和 reload。</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" variant="destructive" disabled={!diagnostics.rebuildAvailable || !currentPassword || submitting}>
            {submitting ? <Spinner data-icon="inline-start" /> : <ServerCogIcon data-icon="inline-start" />}
            重建 Active revision
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
