import * as React from "react";
import { useTranslation } from "react-i18next";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useApiQuery } from "@/hooks/use-api-query";
import {
  getDeployment,
  getManagerSettings,
  publishManagerSettings,
  resetManagerSettings,
  rollbackManagerSettings,
  updateManagerSettings,
} from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n/error";
import { localizedZodResolver } from "@/lib/i18n/form";
import { hostnameSchema } from "@/shared/schemas";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { cn } from "@/lib/utils";
import { ManagerSslForm } from "@/components/pages/settings/forms/manager-ssl-form";

function buildFormSchema() {
  return z.object({
    primaryHostname: hostnameSchema,
    aliases: z.string().max(4096),
    forceHttps: z.boolean(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

function parseAliases(value: string) {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean))];
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "bound":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "draft":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "unbound":
      return "bg-stone-100 text-stone-700 border-stone-200";
    default:
      return "bg-stone-100 text-stone-600 border-stone-200";
  }
}

export function ManagerSettingsForm() {
  const { t } = useTranslation(["common"]);
  const query = useApiQuery(getManagerSettings);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"save" | "publish" | "reset" | "rollback" | null>(null);
  const [deploymentId, setDeploymentId] = React.useState<string | null>(null);
  const formSchema = React.useMemo(() => buildFormSchema(), []);
  const form = useForm<FormValues>({
    resolver: localizedZodResolver(formSchema, t),
    defaultValues: { primaryHostname: "", aliases: "", forceHttps: true },
  });
  const forceHttps = useWatch({ control: form.control, name: "forceHttps" });

  React.useEffect(() => {
    const config = query.data?.config;
    if (!config || !config.bound) {
      form.reset({ primaryHostname: "", aliases: "", forceHttps: true });
      return;
    }
    form.reset({
      primaryHostname: config.primaryHostname,
      aliases: config.aliases.join(", "),
      forceHttps: config.ssl.forceHttps,
    });
  }, [form, query.data]);

  React.useEffect(() => {
    if (!deploymentId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const detail = await getDeployment(deploymentId);
        if (cancelled) return;
        if (detail.deployment.status === "succeeded") {
          toast.success(t("common:settings.manager.publishSucceeded"));
          setDeploymentId(null);
          setBusy(null);
          void query.refresh();
          return;
        }
        if (detail.deployment.status === "failed") {
          setServerError(detail.deployment.errorMessage || t("common:settings.manager.publishFailed"));
          setDeploymentId(null);
          setBusy(null);
          return;
        }
        window.setTimeout(() => void tick(), 1200);
      } catch (error) {
        if (!cancelled) {
          setServerError(formatErrorMessage(t, error, "common:settings.manager.publishFailed"));
          setDeploymentId(null);
          setBusy(null);
        }
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [deploymentId, query, t]);

  const saveDraft = form.handleSubmit(async (values) => {
    setServerError(null);
    setBusy("save");
    try {
      await updateManagerSettings({
        primaryHostname: values.primaryHostname,
        aliases: parseAliases(values.aliases),
        // Only patch forceHttps; server merges enabled / certificateId from current snapshot (C2).
        ssl: { forceHttps: values.forceHttps },
      });
      toast.success(t("common:settings.manager.draftSaved"));
      void query.refresh();
    } catch (error) {
      setServerError(formatErrorMessage(t, error, "common:settings.manager.saveFailed"));
    } finally {
      setBusy(null);
    }
  });

  const publish = async () => {
    setServerError(null);
    setBusy("publish");
    try {
      const result = await publishManagerSettings();
      setDeploymentId(result.deploymentId);
      toast.message(t("common:settings.manager.publishing"));
    } catch (error) {
      setServerError(formatErrorMessage(t, error, "common:settings.manager.publishFailed"));
      setBusy(null);
    }
  };

  const reset = async () => {
    setServerError(null);
    setBusy("reset");
    try {
      await resetManagerSettings();
      toast.success(t("common:settings.manager.resetDraftCreated"));
      void query.refresh();
    } catch (error) {
      setServerError(formatErrorMessage(t, error, "common:settings.manager.resetFailed"));
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (sourceVersionId: string) => {
    setServerError(null);
    setBusy("rollback");
    try {
      const result = await rollbackManagerSettings(sourceVersionId);
      setDeploymentId(result.deploymentId);
      toast.message(t("common:settings.manager.rollingBack"));
    } catch (error) {
      setServerError(formatErrorMessage(t, error, "common:settings.manager.rollbackFailed"));
      setBusy(null);
    }
  };

  if (query.loading && !query.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (query.error && !query.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("common:settings.manager.loadFailed")}</AlertTitle>
        <AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription>
      </Alert>
    );
  }

  const data = query.data!;
  const statusLabel = t(`common:settings.manager.status.${data.status}`);

  return (
    <div className="space-y-6">
      {serverError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("common:settings.manager.operationFailed")}</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-border shadow-none">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="font-normal tracking-tight text-[22px]">{t("common:settings.manager.statusTitle")}</CardTitle>
            <Badge variant="outline" className={cn("rounded-full uppercase tracking-wider text-[11px] font-semibold", statusBadgeClass(data.status))}>
              {statusLabel}
            </Badge>
          </div>
          <CardDescription>{t("common:settings.manager.statusDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            {t("common:settings.manager.localEntrypoints")}:{" "}
            <span className="font-mono text-foreground">
              {data.localEntrypoints.map((host) => `http://${host}`).join(" · ")}
            </span>
          </p>
          {data.config?.bound ? (
            <p>
              {t("common:settings.manager.boundAs")}:{" "}
              <span className="font-mono text-foreground">{data.config.primaryHostname}</span>
              {data.config.aliases.length ? (
                <span className="font-mono"> (+{data.config.aliases.join(", ")})</span>
              ) : null}
            </p>
          ) : (
            <p>{t("common:settings.manager.unconfiguredHint")}</p>
          )}
          {deploymentId ? (
            <p className="flex items-center gap-2 text-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              {t("common:settings.manager.deploymentRunning")}{" "}
              <LocalizedLink className="text-primary underline-offset-4 hover:underline" href={`/deployments?id=${deploymentId}`}>
                {deploymentId.slice(0, 8)}
              </LocalizedLink>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border shadow-none">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">
            {data.status === "unconfigured"
              ? t("common:settings.manager.bindTitle")
              : t("common:settings.manager.rebindTitle")}
          </CardTitle>
          <CardDescription>
            {data.status === "unconfigured"
              ? t("common:settings.manager.bindDescription")
              : t("common:settings.manager.rebindDescription")}
          </CardDescription>
        </CardHeader>
        <form onSubmit={saveDraft}>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={Boolean(form.formState.errors.primaryHostname)}>
                <FieldLabel htmlFor="managerPrimaryHostname">{t("common:settings.manager.primaryHostname")}</FieldLabel>
                <Input
                  id="managerPrimaryHostname"
                  placeholder="panel.example.com"
                  autoComplete="off"
                  aria-invalid={Boolean(form.formState.errors.primaryHostname)}
                  {...form.register("primaryHostname")}
                />
                <FieldDescription>{t("common:settings.manager.primaryHostnameDesc")}</FieldDescription>
                <FieldError errors={[form.formState.errors.primaryHostname]} />
              </Field>
              <Field data-invalid={Boolean(form.formState.errors.aliases)}>
                <FieldLabel htmlFor="managerAliases">{t("common:settings.manager.aliases")}</FieldLabel>
                <Input
                  id="managerAliases"
                  placeholder="admin.example.com"
                  autoComplete="off"
                  {...form.register("aliases")}
                />
                <FieldDescription>{t("common:settings.manager.aliasesDesc")}</FieldDescription>
                <FieldError errors={[form.formState.errors.aliases]} />
              </Field>
              <Field orientation="horizontal" className="items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <FieldLabel>{t("common:settings.manager.forceHttps")}</FieldLabel>
                  <FieldDescription>{t("common:settings.manager.forceHttpsDesc")}</FieldDescription>
                </div>
                <Switch
                  checked={forceHttps}
                  onCheckedChange={(value) => form.setValue("forceHttps", value, { shouldDirty: true })}
                />
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2 border-t border-border">
            <Button type="submit" disabled={busy !== null}>
              {busy === "save" ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
              {t("common:settings.manager.saveDraft")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!data.canPublish || busy !== null}
              onClick={() => void publish()}
            >
              {busy === "publish" ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
              {t("common:settings.manager.publish")}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {data.status === "bound" || data.status === "draft" || data.status === "unbound" ? (
        <ManagerSslForm
          key={`${data.domainId ?? "none"}:${data.config?.ssl.email ?? ""}:${data.config?.ssl.environment ?? ""}`}
          manager={data}
          onChanged={() => void query.refresh()}
        />
      ) : null}

      {data.status !== "unconfigured" ? (
        <Card className="border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">{t("common:settings.manager.versionsTitle")}</CardTitle>
            <CardDescription>{t("common:settings.manager.versionsDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("common:settings.manager.noVersions")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {data.versions.map((version) => (
                  <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        v{version.versionNumber}{" "}
                        <span className="font-mono text-muted-foreground">{version.primaryHostname}</span>
                      </p>
                      <p className="text-muted-foreground">
                        {version.status}
                        {version.changeSummary ? ` · ${version.changeSummary}` : ""}
                      </p>
                    </div>
                    {version.status !== "active" && data.activeVersion ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void rollback(version.id)}
                      >
                        {t("common:settings.manager.rollback")}
                      </Button>
                    ) : (
                      <Badge variant="secondary">{t("common:settings.manager.activeBadge")}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {data.canReset ? (
        <Card className="border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">{t("common:settings.manager.resetTitle")}</CardTitle>
            <CardDescription>{t("common:settings.manager.resetDescription")}</CardDescription>
          </CardHeader>
          <CardFooter>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={busy !== null}>
                  {t("common:settings.manager.resetAction")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("common:settings.manager.resetConfirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("common:settings.manager.resetConfirmDescription")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common:settings.manager.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void reset()}>{t("common:settings.manager.resetAction")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}
