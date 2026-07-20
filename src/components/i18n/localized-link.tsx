import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { AppLocale } from "@/i18n/settings";
import { useLocale } from "@/hooks/use-locale";
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
  const currentLocale = useLocale();
  const locale = requestedLocale ?? currentLocale;

  return (
    <Link href={localizePath(href, locale)} {...props}>
      {children}
    </Link>
  );
}
