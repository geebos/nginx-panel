import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import { useTranslation } from "react-i18next";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { SettingsIcon } from "lucide-react";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { LogViewer } from "@/components/pages/logs/log-viewer";
import { Button } from "@/components/ui/button";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "logs"]);

export default function LogsPage() {
  const { t } = useTranslation(["common", "logs"]);
  return (
    <Page className="px-0 pb-16">
      <PageHeader
        title={t("logs:title")}
        description={t("logs:description")}
        breadcrumbs={[{ label: t("logs:title") }]}
        action={<Button asChild size="sm" variant="outline"><LocalizedLink href="/settings/logs"><SettingsIcon data-icon="inline-start" />{t("logs:logSettings")}</LocalizedLink></Button>}
      />
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8"><LogViewer /></div>
    </Page>
  );
}
