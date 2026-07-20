import * as React from "react";
import { useTranslation } from "react-i18next";
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
import { formatMessageKey, zodIssueParams } from "@/lib/i18n/error";

type SslConfig = DomainConfig["ssl"];

export function SslSettingsForm({ initial, credentials, certificateActive, submitting, orderRunning, onSave, onCreateOrder }: { initial: SslConfig; credentials: CloudflareCredentialSummary[]; certificateActive: boolean; submitting: boolean; orderRunning: boolean; onSave: (ssl: SslConfig) => Promise<void>; onCreateOrder: () => Promise<void> }) {
  const { t } = useTranslation(["common", "domains"]);
  const [ssl, setSsl] = React.useState(initial);
  const [error, setError] = React.useState<string>();
  const validationValue = ssl.validation.method === "http-01" ? "http-01" : ssl.validation.provider === "manual" ? "dns-manual" : "dns-cloudflare";
  const dirty = JSON.stringify(ssl) !== JSON.stringify(initial);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = sslConfigSchema.safeParse(ssl);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(formatMessageKey(t, issue?.message ?? "errors:sslFormInvalid", zodIssueParams(issue)));
      return;
    }
    setError(undefined);
    await onSave(parsed.data);
  };
  return (
    <form onSubmit={save}>
      <Card className="border border-border">
        <CardHeader><CardTitle>{t("domains:forms.sslForm.cardTitle")}</CardTitle><CardDescription>{t("domains:forms.sslForm.cardDescription")}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-5">
          {error ? <Alert variant="destructive"><AlertTitle>{t("domains:forms.sslForm.invalidAlert")}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          <FieldGroup>
            <Field orientation="horizontal"><FieldLabel htmlFor="ssl-enabled">{t("domains:forms.sslForm.enableHttps")}</FieldLabel><Switch id="ssl-enabled" checked={ssl.enabled} onCheckedChange={(enabled) => setSsl((current) => ({ ...current, enabled }))} /></Field>
            <Field><FieldLabel htmlFor="ssl-email">{t("domains:forms.sslForm.acmeEmail")}</FieldLabel><Input id="ssl-email" type="email" value={ssl.email} onChange={(event) => setSsl((current) => ({ ...current, email: event.target.value }))} disabled={!ssl.enabled} /><FieldDescription>{t("domains:forms.sslForm.acmeEmailDesc")}</FieldDescription></Field>
            <Field><FieldLabel>{t("domains:forms.sslForm.environment")}</FieldLabel><Select options={[{ value: "staging", label: t("domains:forms.sslForm.environmentStaging") }, { value: "production", label: t("domains:forms.sslForm.environmentProduction") }]} value={ssl.environment} onChange={(value) => value && setSsl((current) => ({ ...current, environment: value as SslConfig["environment"] }))} disabled={!ssl.enabled} /></Field>
            <Field><FieldLabel>{t("domains:forms.sslForm.validationMethod")}</FieldLabel><Select options={[{ value: "http-01", label: t("domains:forms.sslForm.validationHttp01") }, { value: "dns-manual", label: t("domains:forms.sslForm.validationDnsManual") }, { value: "dns-cloudflare", label: t("domains:forms.sslForm.validationDnsCloudflare"), disabled: !credentials.length }]} value={validationValue} onChange={(value) => setSsl((current) => ({ ...current, validation: value === "dns-manual" ? { method: "dns-01", provider: "manual" } : value === "dns-cloudflare" && credentials[0] ? { method: "dns-01", provider: "cloudflare", cloudflareCredentialId: credentials[0].id } : { method: "http-01" } }))} disabled={!ssl.enabled} /><FieldDescription>{credentials.length ? t("domains:forms.sslForm.validationDescCloudflare") : t("domains:forms.sslForm.validationDescEmpty")}</FieldDescription></Field>
            {ssl.validation.method === "dns-01" && ssl.validation.provider === "cloudflare" ? <Field><FieldLabel>{t("domains:forms.sslForm.cloudflareCredential")}</FieldLabel><Select options={credentials.map((credential) => ({ value: credential.id, label: `${credential.name} · •••• ${credential.tokenLast4}` }))} value={ssl.validation.cloudflareCredentialId} onChange={(value) => value && setSsl((current) => ({ ...current, validation: { method: "dns-01", provider: "cloudflare", cloudflareCredentialId: value } }))} disabled={!ssl.enabled} /></Field> : null}
            <Field orientation="horizontal"><FieldLabel htmlFor="ssl-auto-renew">{t("domains:forms.sslForm.autoRenew")}</FieldLabel><Switch id="ssl-auto-renew" checked={ssl.autoRenew} onCheckedChange={(autoRenew) => setSsl((current) => ({ ...current, autoRenew }))} disabled={!ssl.enabled} /></Field>
            <Field orientation="horizontal"><FieldLabel htmlFor="ssl-force">{t("domains:forms.sslForm.forceHttps")}</FieldLabel><Switch id="ssl-force" checked={ssl.forceHttps} onCheckedChange={(forceHttps) => setSsl((current) => ({ ...current, forceHttps }))} disabled={!ssl.enabled} /></Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2"><Button type="submit" variant="outline" disabled={!dirty || submitting}><SaveIcon />{t("domains:forms.sslForm.saveDraft")}</Button>{!certificateActive ? <Button type="button" disabled={!ssl.enabled || dirty || submitting || orderRunning} onClick={() => void onCreateOrder()}>{submitting ? <LoaderCircleIcon className="animate-spin" /> : <ShieldCheckIcon />}{t("domains:forms.sslForm.requestCertificate")}</Button> : null}</CardFooter>
      </Card>
    </form>
  );
}
