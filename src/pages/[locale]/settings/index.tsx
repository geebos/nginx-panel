import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import * as React from "react";
import { useRouter } from "@/hooks/use-router";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common"]);

export default function SettingsIndexPage() {
  const router = useRouter();
  React.useEffect(() => {
    void router.replace("/settings/general");
  }, [router]);
  return null;
}
