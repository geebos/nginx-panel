import { Page } from "@/components/layout/page";
import { DomainList } from "@/components/pages/domains/domain-list";

export default function DomainsPage() {
  return (
    <Page className="px-0 pb-16">
      <DomainList />
    </Page>
  );
}
