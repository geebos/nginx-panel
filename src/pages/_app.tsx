import "@/styles/globals.css";
import * as React from "react";
import Head from "next/head";
import type { AppProps } from "next/app";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Layout } from "@/components/layout/layout";
import { warmupNetworkPermission } from "@/lib/api";

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

export default function App({ Component, pageProps }: AppProps) {
  React.useEffect(() => {
    void warmupNetworkPermission();
  }, []);

  return (
    <div className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
      </Head>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </div>
  );
}
