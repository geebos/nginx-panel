import "@/styles/globals.css";
import Head from "next/head";
import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Layout } from "@/components/layout/layout";
import { AuthGate } from "@/components/layout/auth-gate";
import { TooltipProvider } from "@/components/ui/tooltip";

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
  const router = useRouter();
  const page = <Component {...pageProps} />;

  return (
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
  );
}
