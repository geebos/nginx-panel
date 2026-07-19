import * as React from "react";
import { useRouter } from "next/router";
import { Page } from "@/components/layout/page";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const router = useRouter();
  React.useEffect(() => {
    void router.replace("/dashboard");
  }, [router]);

  return (
    <Page>
      <div className="mx-auto grid w-full max-w-[1440px] gap-3 py-8 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton className="h-32" key={index} />
        ))}
      </div>
    </Page>
  );
}
