import "@/styles/globals.css";
import * as React from "react";
import Head from "next/head";
import type { AppProps } from "next/app";
import { Layout } from "@/components/layout/layout";
import { warmupNetworkPermission } from "@/lib/api";

export default function App({ Component, pageProps }: AppProps) {
  React.useEffect(() => {
    void warmupNetworkPermission();
  }, []);

  return (
    <>
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
      </Head>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </>
  );
}
