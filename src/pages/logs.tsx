import Link from "next/link";
import { SettingsIcon } from "lucide-react";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { LogViewer } from "@/components/pages/logs/log-viewer";
import { Button } from "@/components/ui/button";

export default function LogsPage() {
  return <Page className="px-0 pb-16"><PageHeader title="Logs" description="按 Domain 查看 Nginx access/error 历史与实时日志。" breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Logs" }]} action={<Button asChild size="sm" variant="outline"><Link href="/settings/logs"><SettingsIcon data-icon="inline-start" />日志设置</Link></Button>} /><div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8"><LogViewer /></div></Page>;
}
