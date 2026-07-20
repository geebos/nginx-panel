import "@/styles/globals.css";
import { useEffect, useMemo } from "react";
import Head from "next/head";
import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { Inter, JetBrains_Mono } from "next/font/google";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { Layout } from "@/components/layout/layout";
import { AuthGate } from "@/components/layout/auth-gate";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type AppLocale,
  type Messages,
} from "@/i18n/settings";

// CursorGothic is licensed — Inter is the open-source substitute per DESIGN.md.
// JetBrains Mono is the in-product/code surface family.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

type I18nPageProps = {
  locale?: AppLocale;
  messages?: Messages;
  fallbackMessages?: Messages;
};

const EMPTY_MESSAGES: Messages = {};

export default function App({ Component, pageProps }: AppProps<I18nPageProps>) {
  const router = useRouter();
  const page = <Component {...pageProps} />;
  const locale = pageProps.locale ?? DEFAULT_LOCALE;
  const messages = pageProps.messages ?? EMPTY_MESSAGES;
  const fallbackMessages = pageProps.fallbackMessages ?? EMPTY_MESSAGES;

  const i18n = useMemo(() => {
    const instance = i18next.createInstance();
    void instance.use(initReactI18next).init({
      lng: locale,
      defaultNS: "common",
      supportedLngs: [...SUPPORTED_LOCALES],
      react: { useSuspense: false },
      resources:
        locale === DEFAULT_LOCALE
          ? { [DEFAULT_LOCALE]: messages }
          : {
              [locale]: messages,
              [DEFAULT_LOCALE]: fallbackMessages,
            },
      fallbackLng: DEFAULT_LOCALE,
      interpolation: { escapeValue: false },
    });
    return instance;
  }, [fallbackMessages, locale, messages]);

  useEffect(() => {
    return () => {
      (i18n as { dispose?: () => void }).dispose?.();
    };
  }, [i18n]);

  return (
    <I18nextProvider i18n={i18n}>
      <div className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <Head>
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
          />
        </Head>
        <TooltipProvider>
          {router.pathname === "/login" ? page : <AuthGate><Layout>{page}</Layout></AuthGate>}
        </TooltipProvider>
      </div>
    </I18nextProvider>
  );
}
