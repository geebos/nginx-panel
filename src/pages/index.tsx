import * as React from "react";
import { useRouter } from "next/router";
import { detectInitialLocale, localizePath } from "@/lib/i18n/utils";

export default function Home() {
  const router = useRouter();
  React.useEffect(() => {
    void detectInitialLocale().then((locale) => {
      void router.replace(localizePath("/dashboard", locale));
    });
  }, [router]);

  return null;
}
