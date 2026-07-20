import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import { Page } from "@/components/layout/page";
import { DashboardContent } from "@/components/pages/dashboard/dashboard-content";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "dashboard"]);

export default function DashboardPage() {
  return (
    <Page className="px-0 pb-16">
      <DashboardContent />
    </Page>
  );
}
