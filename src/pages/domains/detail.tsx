import { Page } from "@/components/layout/page";
import { DomainOverview } from "@/components/pages/domains/domain-overview";
import { DomainRoutes } from "@/components/pages/domains/domain-routes";
import { DomainHistory } from "@/components/pages/domains/domain-history";
import { DomainVersion } from "@/components/pages/domains/domain-version";
import { DomainHeaders } from "@/components/pages/domains/domain-headers";
import { DomainAdvanced } from "@/components/pages/domains/domain-advanced";
import { DomainLogs } from "@/components/pages/domains/domain-logs";
import { DomainSsl } from "@/components/pages/domains/domain-ssl";
import { useRouter } from "next/router";

export default function DomainDetailPage() {
  const router = useRouter();
  const content = /\/versions\//.test(router.asPath)
    ? <DomainVersion />
    : /\/ssl(?:[/?]|$)/.test(router.asPath)
      ? <DomainSsl />
    : /\/history(?:[/?]|$)/.test(router.asPath)
      ? <DomainHistory />
      : /\/logs(?:[/?]|$)/.test(router.asPath)
        ? <DomainLogs />
      : /\/headers(?:[/?]|$)/.test(router.asPath)
        ? <DomainHeaders />
        : /\/advanced(?:[/?]|$)/.test(router.asPath)
          ? <DomainAdvanced />
      : /\/routes(?:[/?]|$)/.test(router.asPath)
        ? <DomainRoutes />
        : <DomainOverview />;
  return (
    <Page className="px-0 pb-16">
      {content}
    </Page>
  );
}
