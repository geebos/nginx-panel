import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useRouter } from "next/router";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type AppLocale,
} from "@/i18n/settings";
import { localizePath } from "@/lib/i18n/utils";

type LocalizedLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  locale?: AppLocale;
  children: ReactNode;
};

export function LocalizedLink({
  href,
  locale: requestedLocale,
  children,
  ...props
}: LocalizedLinkProps) {
  const router = useRouter();
  const routeLocale =
    typeof router.query.locale === "string" &&
    isSupportedLocale(router.query.locale)
      ? router.query.locale
      : DEFAULT_LOCALE;
  const locale = requestedLocale ?? routeLocale;

  return (
    <Link href={localizePath(href, locale)} {...props}>
      {children}
    </Link>
  );
}
