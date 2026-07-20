import { useRouter } from "next/router";
import { DEFAULT_LOCALE, isSupportedLocale, type AppLocale } from "@/i18n/settings";

export function useLocale(): AppLocale {
  const { query } = useRouter();
  const locale = typeof query.locale === "string" ? query.locale : undefined;
  return isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
}
