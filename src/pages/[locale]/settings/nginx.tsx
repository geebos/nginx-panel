import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import { useTranslation } from "react-i18next";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/pages/settings/tabs";
import { NginxSettingsForm } from "@/components/pages/settings/forms/nginx-settings-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { getNginxSettings } from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n/error";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common"]);

export default function NginxSettingsPage() {
  const { t } = useTranslation(["common"]);
  const query = useApiQuery(getNginxSettings);
  return (
    <Page className="px-0 pb-16">
      <PageHeader
        title={t("common:settings.nginx.title")}
        description={t("common:settings.nginx.description")}
        breadcrumbs={[
          { label: t("common:settings.breadcrumbs.settings"), href: "/settings/nginx" },
          { label: t("common:settings.nginx.breadcrumb") },
        ]}
      />
      <SettingsTabs active="nginx" />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        {query.error ? (
          <Alert variant="destructive">
            <AlertTitle>{t("common:settings.nginx.loadFailed")}</AlertTitle>
            <AlertDescription>{formatErrorMessage(t, query.error)}</AlertDescription>
          </Alert>
        ) : null}
        {query.loading && !query.data ? (
          <Skeleton className="h-[620px]" />
        ) : query.data ? (
          <NginxSettingsForm settings={query.data} onSaved={query.refresh} />
        ) : null}
      </div>
    </Page>
  );
}
