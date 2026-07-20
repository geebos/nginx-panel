import settings from "./settings.json";

const LOCALES = ["en", "zh-CN"] as const;

if (
  settings.locales.length !== LOCALES.length ||
  !settings.locales.every((locale, index) => locale === LOCALES[index])
) {
  throw new Error("i18n/settings.json locales does not match LOCALES const");
}

if (!(LOCALES as readonly string[]).includes(settings.defaultLocale)) {
  throw new Error("defaultLocale not in LOCALES");
}

export const DEFAULT_LOCALE = settings.defaultLocale as (typeof LOCALES)[number];
export const SUPPORTED_LOCALES = LOCALES;
export type AppLocale = (typeof LOCALES)[number];

export const PREFERRED_LOCALE_KEY = "preferred-locale";

export function isSupportedLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: string | undefined | null): AppLocale {
  if (!value) return DEFAULT_LOCALE;
  if (isSupportedLocale(value)) return value;
  const language = value.split("-")[0];
  return LOCALES.find((locale) => locale.split("-")[0] === language) ?? DEFAULT_LOCALE;
}

export type Messages = { [key: string]: string | Messages };
