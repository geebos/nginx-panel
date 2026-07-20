import * as React from "react";
import { useRouter } from "@/hooks/use-router";
import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common"]);

/** Locale root (`/en/`, `/zh-CN/`) — redirect into the app so nginx never 403s a bare locale dir. */
export default function LocaleHome() {
  const router = useRouter();
  React.useEffect(() => {
    if (!router.isReady) return;
    void router.replace("/dashboard");
  }, [router]);

  return null;
}
