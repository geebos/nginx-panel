import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import { useTranslation } from "react-i18next";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/pages/settings/tabs";
import { SecuritySettingsForm } from "@/components/pages/settings/forms/security-settings-form";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common"]);

export default function SecuritySettingsPage() {
  const { t } = useTranslation(["common"]);
  return (
    <Page className="px-0 pb-16">
      <PageHeader
        title={t("common:settings.security.title")}
        description={t("common:settings.security.description")}
        breadcrumbs={[
          { label: t("common:settings.breadcrumbs.settings"), href: "/settings/nginx" },
          { label: t("common:settings.security.breadcrumb") },
        ]}
      />
      <SettingsTabs active="security" />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
        <SecuritySettingsForm />
      </div>
    </Page>
  );
}
