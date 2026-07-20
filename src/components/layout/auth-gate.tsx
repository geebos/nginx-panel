import * as React from "react";
import { useRouter } from "next/router";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/api";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { useLocale } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n/utils";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const locale = useLocale();
  const [authenticated, setAuthenticated] = React.useState(false);

  React.useEffect(() => {
    if (!router.isReady) return;
    let active = true;
    void getCurrentUser()
      .then(() => {
        if (active) setAuthenticated(true);
      })
      .catch(() => {
        if (!active) return;
        const redirect = safeRedirectPath(router.asPath);
        void router.replace(localizePath(`/login?redirect=${encodeURIComponent(redirect)}`, locale));
      });
    return () => {
      active = false;
    };
  }, [router, locale]);

  if (!authenticated) {
    return (
      <div className="mx-auto grid min-h-[100dvh] w-full max-w-[1440px] gap-3 p-6 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton className="h-32" key={index} />
        ))}
      </div>
    );
  }

  return children;
}
