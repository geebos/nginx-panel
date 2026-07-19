import { Page } from "@/components/layout/page";
import { CertificateList } from "@/components/pages/certificates/certificate-list";

export default function CertificatesPage() {
  return (
    <Page className="px-0 pb-16">
      <CertificateList />
    </Page>
  );
}
