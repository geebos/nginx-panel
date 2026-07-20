import * as React from "react";
import { useTranslation } from "react-i18next";
import { ExternalLinkIcon, LoaderCircleIcon, PlusIcon, RefreshCwIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CloudflareCredentialSummary } from "@/lib/api";
import { useLocale } from "@/hooks/use-locale";

export function CreateCloudflareCredentialForm({ submitting, onSubmit }: { submitting: boolean; onSubmit: (input: { name: string; token: string }) => Promise<void> }) {
  const { t } = useTranslation(["common"]);
  const [name, setName] = React.useState("");
  const [token, setToken] = React.useState("");
  return <form onSubmit={(event) => { event.preventDefault(); void onSubmit({ name, token }).then(() => { setName(""); setToken(""); }).catch(() => undefined); }}>
    <Card className="border border-border">
      <CardHeader><CardTitle>{t("common:settings.cloudflare.addToken.title")}</CardTitle><CardDescription>{t("common:settings.cloudflare.addToken.description")}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>{t("common:settings.cloudflare.addToken.guideTitle")}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <ol className="list-decimal space-y-1 pl-4">
              <li>{t("common:settings.cloudflare.addToken.guideStep1")}</li>
              <li>{t("common:settings.cloudflare.addToken.guideStep2")}</li>
              <li>{t("common:settings.cloudflare.addToken.guideStep3")}</li>
            </ol>
            <p>{t("common:settings.cloudflare.addToken.guideNote")}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline"><a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">{t("common:settings.cloudflare.addToken.createToken")}<ExternalLinkIcon /></a></Button>
              <Button asChild size="sm" variant="ghost"><a href="https://developers.cloudflare.com/fundamentals/api/get-started/create-token/" target="_blank" rel="noreferrer">{t("common:settings.cloudflare.addToken.viewDocs")}<ExternalLinkIcon /></a></Button>
            </div>
          </AlertDescription>
        </Alert>
        <FieldGroup><Field><FieldLabel htmlFor="cloudflare-name">{t("common:settings.cloudflare.addToken.nameLabel")}</FieldLabel><Input id="cloudflare-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("common:settings.cloudflare.addToken.namePlaceholder")} required maxLength={64} /></Field><Field><FieldLabel htmlFor="cloudflare-token">{t("common:settings.cloudflare.addToken.tokenLabel")}</FieldLabel><Input id="cloudflare-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" required /><FieldDescription>{t("common:settings.cloudflare.addToken.tokenDescription")}</FieldDescription></Field></FieldGroup>
      </CardContent>
      <CardFooter className="justify-end"><Button type="submit" disabled={submitting || !name.trim() || !token.trim()}>{submitting ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}{t("common:settings.cloudflare.addToken.submit")}</Button></CardFooter>
    </Card>
  </form>;
}

export function CloudflareCredentialCard({ credential, submitting, onReplace, onDelete }: { credential: CloudflareCredentialSummary; submitting: boolean; onReplace: (token: string) => Promise<void>; onDelete: () => Promise<void> }) {
  const { t } = useTranslation(["common"]);
  const locale = useLocale();
  const [token, setToken] = React.useState("");
  return <Card className="border border-border">
    <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{credential.name}</CardTitle><CardDescription>{t("common:settings.cloudflare.card.tokenZones", { last4: credential.tokenLast4, count: credential.visibleZoneCount ?? 0 })}</CardDescription></div><span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">{credential.status}</span></div></CardHeader>
    <CardContent><Field><FieldLabel htmlFor={`token-${credential.id}`}>{t("common:settings.cloudflare.card.replaceToken")}</FieldLabel><Input id={`token-${credential.id}`} type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={t("common:settings.cloudflare.card.tokenPlaceholder")} autoComplete="new-password" /><FieldDescription>{credential.lastVerifiedAt ? t("common:settings.cloudflare.card.lastVerified", { date: new Date(credential.lastVerifiedAt).toLocaleString(locale) }) : t("common:settings.cloudflare.card.neverVerified")}</FieldDescription></Field></CardContent>
    <CardFooter className="justify-between"><Button type="button" variant="destructive" size="sm" disabled={submitting} onClick={() => void onDelete().catch(() => undefined)}><Trash2Icon />{t("common:settings.cloudflare.card.delete")}</Button><Button type="button" variant="outline" size="sm" disabled={submitting || !token.trim()} onClick={() => void onReplace(token).then(() => setToken("")).catch(() => undefined)}>{submitting ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}{t("common:settings.cloudflare.card.verifyAndReplace")}</Button></CardFooter>
  </Card>;
}
