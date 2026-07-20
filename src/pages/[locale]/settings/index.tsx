import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import * as React from "react";
import { useRouter } from "next/router";
import { useLocale } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n-utils";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common"]);

export default function SettingsIndexPage() {
  const router = useRouter();
  const locale = useLocale();
  React.useEffect(() => {
    void router.replace(localizePath("/settings/general", locale));
  }, [router, locale]);
  return null;
}
