import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import { useTranslation } from "react-i18next";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { SettingsTabs } from "@/components/pages/settings/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common"]);

export default function GeneralSettingsPage() {
  const { t } = useTranslation(["common"]);
  return (
    <Page className="px-0 pb-16">
      <PageHeader
        title={t("common:settings.general.title")}
        description={t("common:settings.general.description")}
        breadcrumbs={[
          { label: "Settings", href: "/settings/general" },
          { label: "General" },
        ]}
      />
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
    </Page>
  );
}
