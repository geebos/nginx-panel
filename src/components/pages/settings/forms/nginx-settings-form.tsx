import * as React from "react";
import { AlertTriangleIcon, CheckCircle2Icon, LoaderCircleIcon, SaveIcon, ServerCogIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { useLocale } from "@/hooks/use-locale";
import { formatErrorMessage, formatMessageKey } from "@/lib/i18n/error";
import { runtimeStorageSettingsSchema } from "@/shared/schemas";

const MIB = 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes >= 1024 * MIB) return `${(bytes / (1024 * MIB)).toFixed(bytes % (1024 * MIB) === 0 ? 0 : 1)} GiB`;
  return `${Math.round(bytes / MIB)} MiB`;
}

export function NginxSettingsForm({ settings, onSaved }: { settings: NginxSettingsResponse; onSaved: () => Promise<unknown> }) {
  const { t } = useTranslation(["common"]);
  const locale = useLocale();
  const [limitMiB, setLimitMiB] = React.useState(String(settings.storage.maxBytes / MIB));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const usagePercent = settings.storage.maxBytes > 0
    ? Math.min(100, (settings.storage.usedBytes / settings.storage.maxBytes) * 100)
    : 0;

  const formatTimestamp = (value: number | null) => (
    value
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(value)
      : t("common:settings.nginx.notCheckedYet")
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    const limit = Number(limitMiB);
    const parsed = runtimeStorageSettingsSchema.safeParse({ revisionMaxBytes: limit * MIB });
    if (!Number.isInteger(limit) || !parsed.success) {
      setError(t("errors:runtimeStorageInvalid"));
      return;
    }
    setSubmitting(true);
    try {
      await updateNginxSettings(parsed.data.revisionMaxBytes);
      await onSaved();
      toast.success(t("common:settings.nginx.capacitySaved"));
    } catch (caught) {
      setError(formatErrorMessage(t, caught, "errors:requestFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      {error ? <Alert variant="destructive"><AlertTitle>{t("common:settings.nginx.saveFailed")}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {settings.storage.locked ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("common:settings.nginx.capacityLockedTitle")}</AlertTitle>
          <AlertDescription>{t("common:settings.nginx.capacityLockedDescription")}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>{t("common:settings.nginx.artifacts.title")}</CardTitle>
          <CardDescription>{t("common:settings.nginx.artifacts.description")}</CardDescription>
          <CardAction><Badge variant={settings.storage.locked ? "destructive" : "secondary"}>{settings.storage.locked ? t("common:settings.nginx.artifacts.capacityLocked") : t("common:settings.nginx.artifacts.publishable")}</Badge></CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-muted-foreground">{t("common:settings.nginx.artifacts.currentUsage")}</span>
              <span className="font-mono text-sm">{formatBytes(settings.storage.usedBytes)} / {formatBytes(settings.storage.maxBytes)}</span>
            </div>
            <Progress value={usagePercent} aria-label={t("common:settings.nginx.artifacts.usageAria", { percent: usagePercent.toFixed(0) })} />
            <p className="text-xs text-muted-foreground">{t("common:settings.nginx.artifacts.retainedRevisions", { count: settings.storage.retainedRevisionCount, protected: settings.storage.protectedRevisionIds.length })}</p>
          </div>
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="revision-max-mib">{t("common:settings.nginx.artifacts.capacityLimit")}</FieldLabel>
              <InputGroup>
                <InputGroupInput id="revision-max-mib" type="number" inputMode="numeric" min={512} max={20480} step={1} value={limitMiB} aria-invalid={Boolean(error)} onChange={(event) => { setLimitMiB(event.target.value); setError(undefined); }} />
                <InputGroupAddon align="inline-end">MiB</InputGroupAddon>
              </InputGroup>
              <FieldDescription>{t("common:settings.nginx.artifacts.capacityLimitDescription", { min: formatBytes(settings.storage.minimumAllowedBytes) })}</FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={submitting || Number(limitMiB) * MIB === settings.storage.maxBytes}>
            {submitting ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : <SaveIcon data-icon="inline-start" />}
            {t("common:settings.nginx.artifacts.saveCapacity")}
          </Button>
        </CardFooter>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border border-border">
          <CardHeader>
            <CardTitle>{t("common:settings.nginx.runtimeInfo.title")}</CardTitle>
            <CardDescription>{t("common:settings.nginx.runtimeInfo.description")}</CardDescription>
            <CardAction><ServerCogIcon className="text-muted-foreground" /></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div><p className="text-xs text-muted-foreground">{t("common:settings.nginx.runtimeInfo.version")}</p><p className="mt-1 font-mono text-sm">{settings.nginx.version ?? t("common:settings.nginx.runtimeInfo.unavailable")}</p></div>
            <div><p className="text-xs text-muted-foreground">{t("common:settings.nginx.runtimeInfo.configRoot")}</p><code className="mt-1 block break-all text-sm">{settings.paths.configRoot}</code></div>
            <div><p className="text-xs text-muted-foreground">{t("common:settings.nginx.runtimeInfo.staticAllowedRoots")}</p>{settings.paths.staticAllowedRoots.map((root) => <code className="mt-1 block break-all text-sm" key={root}>{root}</code>)}</div>
          </CardContent>
        </Card>

        <Card className="border border-border">
          <CardHeader>
            <CardTitle>{t("common:settings.nginx.health.title")}</CardTitle>
            <CardDescription>{t("common:settings.nginx.health.description")}</CardDescription>
            <CardAction><Badge variant={settings.health.status === "healthy" ? "secondary" : settings.health.status === "degraded" ? "destructive" : "outline"}>{settings.health.status}</Badge></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              {settings.health.status === "healthy" ? <CheckCircle2Icon className="mt-0.5 text-muted-foreground" /> : <AlertTriangleIcon className="mt-0.5 text-muted-foreground" />}
              <div><p className="text-sm font-medium">{formatTimestamp(settings.health.checkedAt)}</p><p className="mt-1 text-xs text-muted-foreground">{t("common:settings.nginx.health.activeRevision", { id: settings.health.activeRevision ?? t("common:settings.nginx.health.notActivated") })}</p></div>
            </div>
            {settings.health.issues.map((issue) => <Alert variant="destructive" key={issue.code}><AlertTitle>{issue.code}</AlertTitle><AlertDescription>{formatMessageKey(t, issue.message)}</AlertDescription></Alert>)}
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
