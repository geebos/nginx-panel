import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import { useTranslation } from "react-i18next";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DomainForm } from "@/components/pages/domains/forms/domain-form";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "domains"]);

export default function CreateDomainPage() {
  const { t } = useTranslation(["common", "domains"]);
  return (
    <Page className="px-0 pb-16">
      <PageHeader
        title={t("domains:create.title")}
        description={t("domains:create.description")}
        breadcrumbs={[
          { label: t("domains:common.breadcrumbs.domains"), href: "/domains" },
          { label: t("domains:common.breadcrumbs.addDomain") },
        ]}
      />
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
        <Card className="border border-border">
          <CardContent>
            <DomainForm />
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
