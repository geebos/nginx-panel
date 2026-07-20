import * as React from "react";
import { useRouter } from "next/router";
import { RotateCwIcon, SaveIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { nginxLogSettingsInputSchema, requiredAccessLogFields, type AccessLogField, type NginxLogSettings } from "@/shared/schemas";
import { rotateLogs, updateLogSettings } from "@/lib/api";
import { useLocale } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n-utils";

const allFields: { value: AccessLogField; label: string }[] = [
  { value: "timestamp", label: "Timestamp" },
  { value: "domain", label: "Domain / Host" },
  { value: "method", label: "HTTP Method" },
  { value: "path", label: "Path" },
  { value: "request_uri", label: "Request URI" },
  { value: "status", label: "Status" },
  { value: "request_time", label: "Request time" },
  { value: "client_ip", label: "Client IP" },
  { value: "upstream_addr", label: "Upstream address" },
  { value: "upstream_status", label: "Upstream status" },
  { value: "upstream_time", label: "Upstream time" },
];

export function LogSettingsForm({ active, preview, logRootConfigured }: { active: NginxLogSettings; preview: string; logRootConfigured: boolean }) {
  const router = useRouter();
  const locale = useLocale();
  const [accessFields, setAccessFields] = React.useState<AccessLogField[]>(active.accessFields);
  const [errorLevel, setErrorLevel] = React.useState(active.errorLevel);
  const [maxFileSizeMiB, setMaxFileSizeMiB] = React.useState(String(active.maxFileSizeMiB));
  const [retainedFiles, setRetainedFiles] = React.useState(String(active.retainedFiles));
  const [submitting, setSubmitting] = React.useState(false);
  const [rotating, setRotating] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    const parsed = nginxLogSettingsInputSchema.safeParse({
      accessFields,
      errorLevel,
      maxFileSizeMiB: Number(maxFileSizeMiB),
      retainedFiles: Number(retainedFiles),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "日志设置无效");
      return;
    }
    setSubmitting(true);
    try {
      const result = await updateLogSettings(parsed.data);
      await router.push(localizePath(`/deployments/detail?id=${result.deploymentId}`, locale));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "日志设置保存失败");
      setSubmitting(false);
    }
  };

  const rotate = async () => {
    setRotating(true);
    setError(undefined);
    try {
      const result = await rotateLogs();
      await router.push(localizePath(`/deployments/detail?id=${result.deploymentId}`, locale));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "日志轮动失败");
      setRotating(false);
    }
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      {error ? <Alert variant="destructive"><AlertTitle>操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {!logRootConfigured ? <Alert variant="destructive"><AlertTitle>日志目录未配置</AlertTitle><AlertDescription>设置 NGINX_LOG_DIR 并重启 runtime 后才能应用日志策略。</AlertDescription></Alert> : null}
      <Card className="border border-border">
        <CardHeader>
          <CardTitle>Access log 字段</CardTitle>
          <CardDescription>核心字段不可移除；可选字段会通过固定 Nginx 变量白名单注入，不接受自定义 format 字符串。</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldSet>
            <FieldLegend variant="label">结构化字段</FieldLegend>
            <FieldGroup className="grid gap-3 md:grid-cols-2">
              {allFields.map((field) => {
                const required = requiredAccessLogFields.includes(field.value as typeof requiredAccessLogFields[number]);
                const checked = accessFields.includes(field.value);
                return (
                  <Field data-disabled={required || undefined} key={field.value} orientation="horizontal">
                    <Checkbox
                      id={`log-field-${field.value}`}
                      checked={checked}
                      disabled={required}
                      onCheckedChange={(next) => setAccessFields((current) => next ? [...current, field.value] : current.filter((value) => value !== field.value))}
                    />
                    <FieldLabel htmlFor={`log-field-${field.value}`}>{field.label}{required ? "（必需）" : ""}</FieldLabel>
                  </Field>
                );
              })}
            </FieldGroup>
          </FieldSet>
        </CardContent>
      </Card>

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>Error 与轮动策略</CardTitle>
          <CardDescription>达到大小阈值后每 30 秒检查一次，采用 rename + Nginx reopen，保留数量不含当前文件。</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel>Error log level</FieldLabel>
              <Select options={["error", "warn", "notice", "info"].map((value) => ({ value, label: value }))} value={errorLevel} onChange={(value) => setErrorLevel((value ?? "warn") as typeof errorLevel)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="max-log-size">单文件大小上限（MiB）</FieldLabel>
              <Input id="max-log-size" inputMode="numeric" min="1" max="1024" value={maxFileSizeMiB} onChange={(event) => setMaxFileSizeMiB(event.target.value)} />
              <FieldDescription>范围 1–1024 MiB。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="retained-log-files">保留文件数量</FieldLabel>
              <Input id="retained-log-files" inputMode="numeric" min="1" max="30" value={retainedFiles} onChange={(event) => setRetainedFiles(event.target.value)} />
              <FieldDescription>范围 1–30，不包含当前 access.log/error.log。</FieldDescription>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <Button type="button" variant="outline" disabled={rotating || submitting} onClick={() => void rotate()}><RotateCwIcon data-icon="inline-start" className={rotating ? "animate-spin" : undefined} />立即轮动全部日志</Button>
          <Button type="submit" disabled={!logRootConfigured || submitting || rotating}><SaveIcon data-icon="inline-start" />保存并应用</Button>
        </CardFooter>
      </Card>

      <Card className="border border-border">
        <CardHeader><CardTitle>当前 Nginx 预览</CardTitle><CardDescription>Active revision {active.revision}，保存任务成功前不会改变。</CardDescription></CardHeader>
        <CardContent><pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs">{preview}</pre></CardContent>
      </Card>
    </form>
  );
}
