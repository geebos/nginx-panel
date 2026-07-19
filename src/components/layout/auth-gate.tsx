import * as React from "react";
import { useRouter } from "next/router";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/api";
import { safeRedirectPath } from "@/lib/safe-redirect";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
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
        void router.replace(`/login?redirect=${encodeURIComponent(redirect)}`);
      });
    return () => {
      active = false;
    };
  }, [router]);

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
