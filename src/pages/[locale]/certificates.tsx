import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import { Page } from "@/components/layout/page";
import { CertificateList } from "@/components/pages/certificates/certificate-list";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "certificates"]);

export default function CertificatesPage() {
  return (
    <Page className="px-0 pb-16">
      <CertificateList />
    </Page>
  );
}
