import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DomainForm } from "@/components/pages/domains/forms/domain-form";

export default function CreateDomainPage() {
  return (
    <Page className="px-0 pb-16">
      <PageHeader
        title="添加域名"
        description="创建 Domain 和 v1 草稿。发布前不会修改线上 Nginx。"
        breadcrumbs={[
          { label: "Domains", href: "/domains" },
          { label: "添加域名" },
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
