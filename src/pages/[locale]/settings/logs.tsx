import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import { useTranslation } from "react-i18next";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { SettingsTabs } from "@/components/pages/settings/tabs";
import { LogSettingsForm } from "@/components/pages/settings/forms/log-settings-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { getLogSettings } from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n/error";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common"]);

export default function LogSettingsPage() {
  const { t } = useTranslation(["common"]);
  const query = useApiQuery(getLogSettings);
  return (
    <Page className="px-0 pb-16">
      <PageHeader
        title={t("common:settings.logs.title")}
        description={t("common:settings.logs.description")}
        breadcrumbs={[
          { label: t("common:settings.breadcrumbs.settings"), href: "/settings/nginx" },
          { label: t("common:settings.logs.breadcrumb") },
        ]}
      />
      <SettingsTabs active="logs" />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        {query.error ? (
          <Alert variant="destructive">
            <AlertTitle>{t("common:settings.logs.loadFailed")}</AlertTitle>
            <AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription>
          </Alert>
        ) : null}
        {query.data?.pendingDeploymentId ? (
          <Alert>
            <AlertTitle>{t("common:settings.logs.applying")}</AlertTitle>
            <AlertDescription>
              <LocalizedLink
                className="underline underline-offset-4"
                href={`/deployments/detail?id=${query.data.pendingDeploymentId}`}
              >
                {t("common:settings.logs.viewDeployment")}
              </LocalizedLink>
            </AlertDescription>
          </Alert>
        ) : null}
        {query.loading && !query.data ? (
          <Skeleton className="h-[640px]" />
        ) : query.data ? (
          <LogSettingsForm
            key={query.data.active.revision}
            active={query.data.active}
            preview={query.data.preview}
            logRootConfigured={query.data.logRootConfigured}
          />
        ) : null}
      </div>
    </Page>
  );
}
