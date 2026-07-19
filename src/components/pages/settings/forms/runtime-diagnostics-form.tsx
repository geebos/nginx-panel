import * as React from "react";
import { useRouter } from "next/router";
import { AlertTriangleIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { rebuildActiveRuntime, reloadManagerTls, type RuntimeDiagnostics } from "@/lib/api";

export function RuntimeDiagnosticsForm({ diagnostics }: { diagnostics: RuntimeDiagnostics }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [reloadingTls, setReloadingTls] = React.useState(false);

  const rebuild = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      const result = await rebuildActiveRuntime(currentPassword);
      await router.push(`/deployments/${result.deploymentId}`);
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
      await router.push(`/deployments/${result.deploymentId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "管理端 TLS 重新加载失败");
      setReloadingTls(false);
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
            {submitting ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
            重建 Active revision
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
