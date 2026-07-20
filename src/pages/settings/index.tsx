import * as React from "react";
import { useRouter } from "next/router";

export default function SettingsIndexPage() {
  const router = useRouter();
  React.useEffect(() => {
    void router.replace("/settings/nginx");
  }, [router]);
  return null;
}
