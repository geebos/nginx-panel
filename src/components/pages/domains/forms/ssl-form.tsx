import * as React from "react";
import { LoaderCircleIcon, SaveIcon, ShieldCheckIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { sslConfigSchema, type DomainConfig } from "@/shared/schemas";
import type { CloudflareCredentialSummary } from "@/lib/api";

type SslConfig = DomainConfig["ssl"];

export function SslSettingsForm({ initial, credentials, certificateActive, submitting, orderRunning, onSave, onCreateOrder }: { initial: SslConfig; credentials: CloudflareCredentialSummary[]; certificateActive: boolean; submitting: boolean; orderRunning: boolean; onSave: (ssl: SslConfig) => Promise<void>; onCreateOrder: () => Promise<void> }) {
  const [ssl, setSsl] = React.useState(initial);
  const [error, setError] = React.useState<string>();
  const validationValue = ssl.validation.method === "http-01" ? "http-01" : ssl.validation.provider === "manual" ? "dns-manual" : "dns-cloudflare";
  const dirty = JSON.stringify(ssl) !== JSON.stringify(initial);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = sslConfigSchema.safeParse(ssl);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "SSL 设置无效"); return; }
    setError(undefined);
    await onSave(parsed.data);
  };
  return (
    <form onSubmit={save}>
      <Card className="border border-border">
        <CardHeader><CardTitle>HTTPS 设置</CardTitle><CardDescription>保存只更新草稿；证书申请和配置发布是两个独立步骤。</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-5">
          {error ? <Alert variant="destructive"><AlertTitle>设置无效</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          <FieldGroup>
            <Field orientation="horizontal"><FieldLabel htmlFor="ssl-enabled">启用 HTTPS</FieldLabel><Switch id="ssl-enabled" checked={ssl.enabled} onCheckedChange={(enabled) => setSsl((current) => ({ ...current, enabled }))} /></Field>
            <Field><FieldLabel htmlFor="ssl-email">ACME Email</FieldLabel><Input id="ssl-email" type="email" value={ssl.email} onChange={(event) => setSsl((current) => ({ ...current, email: event.target.value }))} disabled={!ssl.enabled} /><FieldDescription>用于 Let&apos;s Encrypt 到期和账户通知。</FieldDescription></Field>
            <Field><FieldLabel>Environment</FieldLabel><Select options={[{ value: "staging", label: "Staging（测试证书）" }, { value: "production", label: "Production" }]} value={ssl.environment} onChange={(value) => value && setSsl((current) => ({ ...current, environment: value as SslConfig["environment"] }))} disabled={!ssl.enabled} /></Field>
            <Field><FieldLabel>验证方式</FieldLabel><Select options={[{ value: "http-01", label: "HTTP-01" }, { value: "dns-manual", label: "DNS-01 Manual" }, { value: "dns-cloudflare", label: "DNS-01 Cloudflare", disabled: !credentials.length }]} value={validationValue} onChange={(value) => setSsl((current) => ({ ...current, validation: value === "dns-manual" ? { method: "dns-01", provider: "manual" } : value === "dns-cloudflare" && credentials[0] ? { method: "dns-01", provider: "cloudflare", cloudflareCredentialId: credentials[0].id } : { method: "http-01" } }))} disabled={!ssl.enabled} /><FieldDescription>{credentials.length ? "Cloudflare 模式会自动创建并在终态精确删除 TXT 记录。" : "请先在 Settings / Cloudflare DNS 添加凭据。"}</FieldDescription></Field>
            {ssl.validation.method === "dns-01" && ssl.validation.provider === "cloudflare" ? <Field><FieldLabel>Cloudflare 凭据</FieldLabel><Select options={credentials.map((credential) => ({ value: credential.id, label: `${credential.name} · •••• ${credential.tokenLast4}` }))} value={ssl.validation.cloudflareCredentialId} onChange={(value) => value && setSsl((current) => ({ ...current, validation: { method: "dns-01", provider: "cloudflare", cloudflareCredentialId: value } }))} disabled={!ssl.enabled} /></Field> : null}
            <Field orientation="horizontal"><FieldLabel htmlFor="ssl-auto-renew">自动续期</FieldLabel><Switch id="ssl-auto-renew" checked={ssl.autoRenew} onCheckedChange={(autoRenew) => setSsl((current) => ({ ...current, autoRenew }))} disabled={!ssl.enabled} /></Field>
            <Field orientation="horizontal"><FieldLabel htmlFor="ssl-force">强制 HTTPS（308）</FieldLabel><Switch id="ssl-force" checked={ssl.forceHttps} onCheckedChange={(forceHttps) => setSsl((current) => ({ ...current, forceHttps }))} disabled={!ssl.enabled} /></Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2"><Button type="submit" variant="outline" disabled={!dirty || submitting}><SaveIcon />保存草稿</Button>{!certificateActive ? <Button type="button" disabled={!ssl.enabled || dirty || submitting || orderRunning} onClick={() => void onCreateOrder()}>{submitting ? <LoaderCircleIcon className="animate-spin" /> : <ShieldCheckIcon />}申请证书</Button> : null}</CardFooter>
      </Card>
    </form>
  );
}
