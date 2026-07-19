import * as React from "react";
import { ExternalLinkIcon, LoaderCircleIcon, PlusIcon, RefreshCwIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CloudflareCredentialSummary } from "@/lib/api";

export function CreateCloudflareCredentialForm({ submitting, onSubmit }: { submitting: boolean; onSubmit: (input: { name: string; token: string }) => Promise<void> }) {
  const [name, setName] = React.useState("");
  const [token, setToken] = React.useState("");
  return <form onSubmit={(event) => { event.preventDefault(); void onSubmit({ name, token }).then(() => { setName(""); setToken(""); }).catch(() => undefined); }}>
    <Card className="border border-border">
      <CardHeader><CardTitle>添加 API Token</CardTitle><CardDescription>Token 会先在线验证，再使用 AES-256-GCM 加密保存；保存后不再回显。</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>在 Cloudflare 创建最小权限 Token</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <ol className="list-decimal space-y-1 pl-4">
              <li>使用 Edit zone DNS 模板，或创建 Custom Token。</li>
              <li>授予 Zone / DNS / Edit 和 Zone / Zone / Read。</li>
              <li>Zone Resources 只包含需要签发证书的 Zone。</li>
            </ol>
            <p>Cloudflare 中选择的 Account 和 Zone 已写入 Token 权限范围；Account ID 无需复制到这里。Token secret 只显示一次，请创建后立即粘贴并保存。</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline"><a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">创建 API Token<ExternalLinkIcon /></a></Button>
              <Button asChild size="sm" variant="ghost"><a href="https://developers.cloudflare.com/fundamentals/api/get-started/create-token/" target="_blank" rel="noreferrer">查看官方文档<ExternalLinkIcon /></a></Button>
            </div>
          </AlertDescription>
        </Alert>
        <FieldGroup><Field><FieldLabel htmlFor="cloudflare-name">凭据名称</FieldLabel><Input id="cloudflare-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Production DNS" required maxLength={64} /></Field><Field><FieldLabel htmlFor="cloudflare-token">Cloudflare API Token</FieldLabel><Input id="cloudflare-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" required /><FieldDescription>需要 Zone Read 与 DNS Edit 权限，且必须覆盖待签发域名的 Zone。</FieldDescription></Field></FieldGroup>
      </CardContent>
      <CardFooter className="justify-end"><Button type="submit" disabled={submitting || !name.trim() || !token.trim()}>{submitting ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}验证并保存</Button></CardFooter>
    </Card>
  </form>;
}

export function CloudflareCredentialCard({ credential, submitting, onReplace, onDelete }: { credential: CloudflareCredentialSummary; submitting: boolean; onReplace: (token: string) => Promise<void>; onDelete: () => Promise<void> }) {
  const [token, setToken] = React.useState("");
  return <Card className="border border-border">
    <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{credential.name}</CardTitle><CardDescription>Token •••• {credential.tokenLast4} · {credential.visibleZoneCount ?? 0} zones</CardDescription></div><span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">{credential.status}</span></div></CardHeader>
    <CardContent><Field><FieldLabel htmlFor={`token-${credential.id}`}>替换 Token</FieldLabel><Input id={`token-${credential.id}`} type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="输入新 Token" autoComplete="new-password" /><FieldDescription>最近验证：{credential.lastVerifiedAt ? new Date(credential.lastVerifiedAt).toLocaleString("zh-CN") : "尚未验证"}</FieldDescription></Field></CardContent>
    <CardFooter className="justify-between"><Button type="button" variant="destructive" size="sm" disabled={submitting} onClick={() => void onDelete().catch(() => undefined)}><Trash2Icon />删除</Button><Button type="button" variant="outline" size="sm" disabled={submitting || !token.trim()} onClick={() => void onReplace(token).then(() => setToken("")).catch(() => undefined)}>{submitting ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}验证并替换</Button></CardFooter>
  </Card>;
}
