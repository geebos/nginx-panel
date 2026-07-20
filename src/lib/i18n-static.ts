import type {
  GetStaticPaths,
  GetStaticPropsContext,
  GetStaticPropsResult,
} from "next";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  SUPPORTED_LOCALES,
  type AppLocale,
  type Messages,
} from "@/i18n/settings";
import common from "../../public/locales/common.json";

const MESSAGES: Record<string, Record<string, unknown>> = { common };

export type StaticPageContext = GetStaticPropsContext<{
  locale?: string;
  [key: string]: string | string[] | undefined;
}>;

export type I18nProps = {
  locale: AppLocale;
  messages: Messages;
  fallbackMessages: Messages;
};

export function pickLocale(node: unknown, locale: AppLocale): Messages {
  if (node === null || typeof node !== "object") {
    return node as unknown as Messages;
  }
  if (Array.isArray(node)) {
    return node.map((item) => pickLocale(item, locale)) as unknown as Messages;
  }

  const entries = Object.entries(node as Record<string, unknown>);
  const isLeaf =
    entries.length > 0 &&
    entries.every(
      ([key, value]) =>
        (SUPPORTED_LOCALES as readonly string[]).includes(key) &&
        typeof value === "string",
    );

  if (isLeaf) {
    return (node as Record<string, string>)[locale] as unknown as Messages;
  }

  const result: Messages = {};
  for (const [key, value] of entries) result[key] = pickLocale(value, locale);
  return result;
}

export function getLocaleFromContext(ctx: StaticPageContext): AppLocale | null {
  const locale = ctx.params?.locale;
  return isSupportedLocale(locale) ? locale : null;
}

export const getLocaleStaticPaths: GetStaticPaths = async () => ({
  paths: SUPPORTED_LOCALES.map((locale) => ({ params: { locale } })),
  fallback: false,
});

export async function getI18nProps(
  ctx: StaticPageContext,
  namespaces: string[],
): Promise<I18nProps | null> {
  const locale = getLocaleFromContext(ctx);
  if (!locale) return null;

  const messages: Messages = {};
  const fallbackMessages: Messages = {};
  for (const namespace of namespaces) {
    const merged = MESSAGES[namespace];
    if (!merged) continue;
    const picked = pickLocale(merged, locale);
    messages[namespace] = picked;
    fallbackMessages[namespace] =
      locale === DEFAULT_LOCALE ? picked : pickLocale(merged, DEFAULT_LOCALE);
  }

  return { locale, messages, fallbackMessages };
}

export function makeStaticProps(namespaces: string[]) {
  return async (
    ctx: StaticPageContext,
  ): Promise<GetStaticPropsResult<I18nProps>> => {
    const props = await getI18nProps(ctx, namespaces);
    if (!props) return { notFound: true };
    return { props };
  };
}

export { DEFAULT_LOCALE, SUPPORTED_LOCALES };
