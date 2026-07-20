import * as React from "react";
import { useTranslation } from "react-i18next";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { SettingsTabs } from "@/components/pages/settings/settings-tabs";
import { LogSettingsForm } from "@/components/pages/settings/forms/log-settings-form";
import { RuntimeDiagnosticsForm } from "@/components/pages/settings/forms/runtime-diagnostics-form";
import { SecuritySettingsForm } from "@/components/pages/settings/forms/security-settings-form";
import { NginxSettingsForm } from "@/components/pages/settings/forms/nginx-settings-form";
import { CloudflareCredentialCard, CreateCloudflareCredentialForm } from "@/components/pages/settings/forms/cloudflare-credential-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { createCloudflareCredential, deleteCloudflareCredential, getCloudflareCredentials, getLogSettings, getNginxSettings, getRuntimeDiagnostics, replaceCloudflareCredentialToken } from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n-error";
import { toast } from "sonner";
import { getI18nProps, SUPPORTED_LOCALES, type StaticPageContext } from "@/lib/i18n-static";

const SETTINGS_TABS = ["general", "nginx", "security", "cloudflare", "logs", "diagnostics"] as const;

export async function getStaticPaths() {
  return {
    paths: SUPPORTED_LOCALES.flatMap((locale) =>
      SETTINGS_TABS.map((tab) => ({ params: { locale, tab } })),
    ),
    fallback: false,
  };
}

export async function getStaticProps(ctx: StaticPageContext) {
  const tab = ctx.params?.tab;
  const i18n = await getI18nProps(ctx, ["common"]);
  if (!i18n || typeof tab !== "string") return { notFound: true };
  return { props: { ...i18n, tab } };
}

function GeneralSettingsPage() {
  const { t } = useTranslation(["common"]);
  return (
    <>
      <PageHeader title={t("common:settings.general.title")} description={t("common:settings.general.description")} breadcrumbs={[{ label: "Settings", href: "/settings/general" }, { label: "General" }]} />
      <SettingsTabs active="general" />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("common:settings.general.language.title")}</CardTitle>
            <CardDescription>{t("common:settings.general.language.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <LanguageSwitcher variant="card" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function LogSettingsPage() {
  const { t } = useTranslation(["common"]);
  const query = useApiQuery(getLogSettings);
  return (
    <>
      <PageHeader title={t("common:settings.logs.title")} description={t("common:settings.logs.description")} breadcrumbs={[{ label: t("common:settings.breadcrumbs.settings"), href: "/settings/nginx" }, { label: t("common:settings.logs.breadcrumb") }]} />
      <SettingsTabs active="logs" />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>{t("common:settings.logs.loadFailed")}</AlertTitle><AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription></Alert> : null}
        {query.data?.pendingDeploymentId ? <Alert><AlertTitle>{t("common:settings.logs.applying")}</AlertTitle><AlertDescription><LocalizedLink className="underline underline-offset-4" href={`/deployments/detail?id=${query.data.pendingDeploymentId}`}>{t("common:settings.logs.viewDeployment")}</LocalizedLink></AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-[640px]" /> : query.data ? <LogSettingsForm key={query.data.active.revision} active={query.data.active} preview={query.data.preview} logRootConfigured={query.data.logRootConfigured} /> : null}
      </div>
    </>
  );
}

function DiagnosticsPage() {
  const { t } = useTranslation(["common"]);
  const query = useApiQuery(getRuntimeDiagnostics);
  return (
    <>
      <PageHeader title={t("common:settings.diagnostics.title")} description={t("common:settings.diagnostics.description")} breadcrumbs={[{ label: t("common:settings.breadcrumbs.settings"), href: "/settings/nginx" }, { label: t("common:settings.diagnostics.breadcrumb") }]} />
      <SettingsTabs active="diagnostics" />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>{t("common:settings.diagnostics.loadFailed")}</AlertTitle><AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-[520px]" /> : query.data ? <RuntimeDiagnosticsForm diagnostics={query.data} /> : null}
      </div>
    </>
  );
}

function CloudflareSettingsPage() {
  const { t } = useTranslation(["common"]);
  const query = useApiQuery(getCloudflareCredentials);
  const [submittingId, setSubmittingId] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const run = async (id: string, action: () => Promise<unknown>, message: string) => {
    setSubmittingId(id); setError(undefined);
    try { await action(); toast.success(message); await query.refresh(); }
    catch (caught) { setError(formatErrorMessage(t, caught, "common:settings.cloudflare.operationFailed")); throw caught; }
    finally { setSubmittingId(undefined); }
  };
  return (
    <>
      <PageHeader title={t("common:settings.cloudflare.title")} description={t("common:settings.cloudflare.description")} breadcrumbs={[{ label: t("common:settings.breadcrumbs.settings"), href: "/settings/nginx" }, { label: t("common:settings.cloudflare.breadcrumb") }]} />
      <SettingsTabs active="cloudflare" />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 md:px-8">
        {error || query.error ? <Alert variant="destructive"><AlertTitle>{t("common:settings.cloudflare.operationFailed")}</AlertTitle><AlertDescription>{error ?? (query.error ? formatErrorMessage(t, query.error) : null)}</AlertDescription></Alert> : null}
        <CreateCloudflareCredentialForm submitting={submittingId === "new"} onSubmit={(input) => run("new", () => createCloudflareCredential(input), t("common:settings.cloudflare.saved"))} />
        {query.loading && !query.data ? <Skeleton className="h-56" /> : query.data?.items.map((credential) => <CloudflareCredentialCard key={credential.id} credential={credential} submitting={submittingId === credential.id} onReplace={(token) => run(credential.id, () => replaceCloudflareCredentialToken(credential.id, token), t("common:settings.cloudflare.tokenReplaced"))} onDelete={() => run(credential.id, () => deleteCloudflareCredential(credential.id), t("common:settings.cloudflare.deleted"))} />)}
      </div>
    </>
  );
}

function SecuritySettingsPage() {
  const { t } = useTranslation(["common"]);
  return (
    <>
      <PageHeader title={t("common:settings.security.title")} description={t("common:settings.security.description")} breadcrumbs={[{ label: t("common:settings.breadcrumbs.settings"), href: "/settings/nginx" }, { label: t("common:settings.security.breadcrumb") }]} />
      <SettingsTabs active="security" />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        <SecuritySettingsForm />
      </div>
    </>
  );
}

function NginxSettingsPage() {
  const { t } = useTranslation(["common"]);
  const query = useApiQuery(getNginxSettings);
  return (
    <>
      <PageHeader title={t("common:settings.nginx.title")} description={t("common:settings.nginx.description")} breadcrumbs={[{ label: t("common:settings.breadcrumbs.settings"), href: "/settings/nginx" }, { label: t("common:settings.nginx.breadcrumb") }]} />
      <SettingsTabs active="nginx" />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>{t("common:settings.nginx.loadFailed")}</AlertTitle><AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-[620px]" /> : query.data ? <NginxSettingsForm settings={query.data} onSaved={query.refresh} /> : null}
      </div>
    </>
  );
}

export default function SettingsTabPage({ tab }: { tab: string }) {
  const content = tab === "general" ? <GeneralSettingsPage />
    : tab === "logs" ? <LogSettingsPage />
    : tab === "diagnostics" ? <DiagnosticsPage />
    : tab === "cloudflare" ? <CloudflareSettingsPage />
    : tab === "security" ? <SecuritySettingsPage />
    : tab === "nginx" ? <NginxSettingsPage />
    : null;
  return <Page className="px-0 pb-16">{content}</Page>;
}
