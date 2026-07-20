import { useMemo } from "react";
import {
  useRouter as useNextRouter,
  type NextRouter,
} from "next/router";
import type { AppLocale } from "@/i18n/settings";
import { useLocale } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n/utils";

type Url = Parameters<NextRouter["push"]>[0];

function localizeUrl<T extends Url | undefined>(url: T, locale: AppLocale): T {
  if (url === undefined) return url;
  if (typeof url === "string") return localizePath(url, locale) as T;
  return url;
}

/** Drop-in for next/router; string paths are localized. Pass locale-free paths only. */
export function useRouter(): NextRouter {
  const router = useNextRouter();
  const locale = useLocale();

  return useMemo(
    () => ({
      ...router,
      push(url, as, options) {
        return router.push(localizeUrl(url, locale), localizeUrl(as, locale), options);
      },
      replace(url, as, options) {
        return router.replace(localizeUrl(url, locale), localizeUrl(as, locale), options);
      },
      prefetch(url, asPath, options) {
        return router.prefetch(localizePath(url, locale), localizeUrl(asPath, locale), options);
      },
    }),
    [locale, router],
  );
}
