import * as React from "react";
import { useRouter } from "next/router";
import { useTranslation } from "react-i18next";
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
import { formatErrorMessage, formatMessageKey, zodIssueParams } from "@/lib/i18n/error";
import { localizePath } from "@/lib/i18n/utils";

const allFieldValues: AccessLogField[] = [
  "timestamp",
  "domain",
  "method",
  "path",
  "request_uri",
  "status",
  "request_time",
  "client_ip",
  "upstream_addr",
  "upstream_status",
  "upstream_time",
];

export function LogSettingsForm({ active, preview, logRootConfigured }: { active: NginxLogSettings; preview: string; logRootConfigured: boolean }) {
  const { t } = useTranslation(["common"]);
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
      const issue = parsed.error.issues[0];
      setError(formatMessageKey(t, issue?.message ?? "errors:logSettingsInvalid", zodIssueParams(issue)));
      return;
    }
    setSubmitting(true);
    try {
      const result = await updateLogSettings(parsed.data);
      await router.push(localizePath(`/deployments/detail?id=${result.deploymentId}`, locale));
    } catch (caught) {
      setError(formatErrorMessage(t, caught, "errors:requestFailed"));
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
      setError(formatErrorMessage(t, caught, "errors:requestFailed"));
      setRotating(false);
    }
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      {error ? <Alert variant="destructive"><AlertTitle>{t("common:settings.logs.operationFailed")}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {!logRootConfigured ? <Alert variant="destructive"><AlertTitle>{t("common:settings.logs.logRootNotConfigured")}</AlertTitle><AlertDescription>{t("common:settings.logs.logRootNotConfiguredDescription")}</AlertDescription></Alert> : null}
      <Card className="border border-border">
        <CardHeader>
          <CardTitle>{t("common:settings.logs.accessFields.title")}</CardTitle>
          <CardDescription>{t("common:settings.logs.accessFields.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldSet>
            <FieldLegend variant="label">{t("common:settings.logs.accessFields.legend")}</FieldLegend>
            <FieldGroup className="grid gap-3 md:grid-cols-2">
              {allFieldValues.map((value) => {
                const required = requiredAccessLogFields.includes(value as typeof requiredAccessLogFields[number]);
                const checked = accessFields.includes(value);
                return (
                  <Field data-disabled={required || undefined} key={value} orientation="horizontal">
                    <Checkbox
                      id={`log-field-${value}`}
                      checked={checked}
                      disabled={required}
                      onCheckedChange={(next) => setAccessFields((current) => next ? [...current, value] : current.filter((field) => field !== value))}
                    />
                    <FieldLabel htmlFor={`log-field-${value}`}>{t(`common:settings.logs.accessFields.fields.${value}`)}{required ? t("common:settings.logs.accessFields.required") : ""}</FieldLabel>
                  </Field>
                );
              })}
            </FieldGroup>
          </FieldSet>
        </CardContent>
      </Card>

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>{t("common:settings.logs.rotation.title")}</CardTitle>
          <CardDescription>{t("common:settings.logs.rotation.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel>{t("common:settings.logs.rotation.errorLogLevel")}</FieldLabel>
              <Select options={["error", "warn", "notice", "info"].map((value) => ({ value, label: value }))} value={errorLevel} onChange={(value) => setErrorLevel((value ?? "warn") as typeof errorLevel)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="max-log-size">{t("common:settings.logs.rotation.maxFileSize")}</FieldLabel>
              <Input id="max-log-size" inputMode="numeric" min="1" max="1024" value={maxFileSizeMiB} onChange={(event) => setMaxFileSizeMiB(event.target.value)} />
              <FieldDescription>{t("common:settings.logs.rotation.maxFileSizeDescription")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="retained-log-files">{t("common:settings.logs.rotation.retainedFiles")}</FieldLabel>
              <Input id="retained-log-files" inputMode="numeric" min="1" max="30" value={retainedFiles} onChange={(event) => setRetainedFiles(event.target.value)} />
              <FieldDescription>{t("common:settings.logs.rotation.retainedFilesDescription")}</FieldDescription>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <Button type="button" variant="outline" disabled={rotating || submitting} onClick={() => void rotate()}><RotateCwIcon data-icon="inline-start" className={rotating ? "animate-spin" : undefined} />{t("common:settings.logs.rotation.rotateNow")}</Button>
          <Button type="submit" disabled={!logRootConfigured || submitting || rotating}><SaveIcon data-icon="inline-start" />{t("common:settings.logs.rotation.saveAndApply")}</Button>
        </CardFooter>
      </Card>

      <Card className="border border-border">
        <CardHeader><CardTitle>{t("common:settings.logs.preview.title")}</CardTitle><CardDescription>{t("common:settings.logs.preview.description", { revision: active.revision })}</CardDescription></CardHeader>
        <CardContent><pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs">{preview}</pre></CardContent>
      </Card>
    </form>
  );
}
