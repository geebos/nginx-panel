import * as React from "react";
import { AlertTriangleIcon, CheckCircle2Icon, LoaderCircleIcon, SaveIcon, ServerCogIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import type { NginxSettingsResponse } from "@/lib/api";
import { updateNginxSettings } from "@/lib/api";
import { runtimeStorageSettingsSchema } from "@/shared/schemas";

const MIB = 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes >= 1024 * MIB) return `${(bytes / (1024 * MIB)).toFixed(bytes % (1024 * MIB) === 0 ? 0 : 1)} GiB`;
  return `${Math.round(bytes / MIB)} MiB`;
}

function formatTimestamp(value: number | null) {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(value) : "尚未检查";
}

export function NginxSettingsForm({ settings, onSaved }: { settings: NginxSettingsResponse; onSaved: () => Promise<unknown> }) {
  const [limitMiB, setLimitMiB] = React.useState(String(settings.storage.maxBytes / MIB));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const usagePercent = settings.storage.maxBytes > 0
    ? Math.min(100, (settings.storage.usedBytes / settings.storage.maxBytes) * 100)
    : 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    const limit = Number(limitMiB);
    const parsed = runtimeStorageSettingsSchema.safeParse({ revisionMaxBytes: limit * MIB });
    if (!Number.isInteger(limit) || !parsed.success) {
      setError("容量上限必须是 512–20480 MiB 的整数值");
      return;
    }
    setSubmitting(true);
    try {
      await updateNginxSettings(parsed.data.revisionMaxBytes);
      await onSaved();
      toast.success("Runtime artifacts 容量上限已保存并完成清理");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nginx 设置保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      {error ? <Alert variant="destructive"><AlertTitle>设置保存失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {settings.storage.locked ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>新 revision 容量不足</AlertTitle>
          <AlertDescription>下一次发布的容量或磁盘空间预检未通过。请提高上限或释放磁盘空间后再发布。</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>Runtime artifacts</CardTitle>
          <CardDescription>保存后立即执行 retention cleanup，不会 reload Nginx。</CardDescription>
          <CardAction><Badge variant={settings.storage.locked ? "destructive" : "secondary"}>{settings.storage.locked ? "容量受限" : "可发布"}</Badge></CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-muted-foreground">当前用量</span>
              <span className="font-mono text-sm">{formatBytes(settings.storage.usedBytes)} / {formatBytes(settings.storage.maxBytes)}</span>
            </div>
            <Progress value={usagePercent} aria-label={`Runtime artifacts 已使用 ${usagePercent.toFixed(0)}%`} />
            <p className="text-xs text-muted-foreground">保留 {settings.storage.retainedRevisionCount} 个 revision，其中 {settings.storage.protectedRevisionIds.length} 个受保护。</p>
          </div>
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="revision-max-mib">容量上限</FieldLabel>
              <InputGroup>
                <InputGroupInput id="revision-max-mib" type="number" inputMode="numeric" min={512} max={20480} step={1} value={limitMiB} aria-invalid={Boolean(error)} onChange={(event) => { setLimitMiB(event.target.value); setError(undefined); }} />
                <InputGroupAddon align="inline-end">MiB</InputGroupAddon>
              </InputGroup>
              <FieldDescription>允许范围 512–20480 MiB。受保护 revision 当前至少需要 {formatBytes(settings.storage.minimumAllowedBytes)}。</FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={submitting || Number(limitMiB) * MIB === settings.storage.maxBytes}>
            {submitting ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : <SaveIcon data-icon="inline-start" />}
            保存容量上限
          </Button>
        </CardFooter>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border border-border">
          <CardHeader>
            <CardTitle>Nginx 运行信息</CardTitle>
            <CardDescription>由当前容器和只读部署环境提供。</CardDescription>
            <CardAction><ServerCogIcon className="text-muted-foreground" /></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div><p className="text-xs text-muted-foreground">版本</p><p className="mt-1 font-mono text-sm">{settings.nginx.version ?? "不可用"}</p></div>
            <div><p className="text-xs text-muted-foreground">配置根目录</p><code className="mt-1 block break-all text-sm">{settings.paths.configRoot}</code></div>
            <div><p className="text-xs text-muted-foreground">静态文件允许根目录</p>{settings.paths.staticAllowedRoots.map((root) => <code className="mt-1 block break-all text-sm" key={root}>{root}</code>)}</div>
          </CardContent>
        </Card>

        <Card className="border border-border">
          <CardHeader>
            <CardTitle>最近健康检查</CardTitle>
            <CardDescription>反映 Active revision 的最近一次运行校验。</CardDescription>
            <CardAction><Badge variant={settings.health.status === "healthy" ? "secondary" : settings.health.status === "degraded" ? "destructive" : "outline"}>{settings.health.status}</Badge></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              {settings.health.status === "healthy" ? <CheckCircle2Icon className="mt-0.5 text-muted-foreground" /> : <AlertTriangleIcon className="mt-0.5 text-muted-foreground" />}
              <div><p className="text-sm font-medium">{formatTimestamp(settings.health.checkedAt)}</p><p className="mt-1 text-xs text-muted-foreground">Active revision：{settings.health.activeRevision ?? "尚未激活"}</p></div>
            </div>
            {settings.health.issues.map((issue) => <Alert variant="destructive" key={issue.code}><AlertTitle>{issue.code}</AlertTitle><AlertDescription>{issue.message}</AlertDescription></Alert>)}
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
