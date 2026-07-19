import Link from "next/link";
import { RefreshCwIcon, RocketIcon } from "lucide-react";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { useApiQuery } from "@/hooks/use-api-query";
import { getDeployments } from "@/lib/api";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function DeploymentsPage() {
  const query = useApiQuery(getDeployments);
  return (
    <Page className="px-0 pb-16">
      <PageHeader
        title="Deployments"
        description="配置测试、发布、回滚和系统任务的审计记录。"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Deployments" }]}
        action={<Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing}><RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />刷新</Button>}
      />
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>发布记录加载失败</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-80" /> : query.data?.items.length ? (
          <div className="rounded-xl border border-border bg-card">
            <Table><TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Domain</TableHead><TableHead>Started</TableHead><TableHead>Duration</TableHead></TableRow></TableHeader><TableBody>
              {query.data.items.map((item) => (
                <TableRow key={item.id}><TableCell><Link className="font-mono text-xs underline-offset-4 hover:underline" href={`/deployments/${item.id}`}>{item.id.slice(0, 8)}</Link></TableCell><TableCell className="capitalize">{item.type}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell className="font-mono text-xs">{item.domainId?.slice(0, 8) ?? "Global"}</TableCell><TableCell>{dateFormatter.format(item.startedAt ?? item.createdAt)}</TableCell><TableCell>{item.startedAt && item.finishedAt ? `${item.finishedAt - item.startedAt} ms` : "-"}</TableCell></TableRow>
              ))}
            </TableBody></Table>
          </div>
        ) : (
          <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><RocketIcon /></EmptyMedia><EmptyTitle>还没有任务</EmptyTitle><EmptyDescription>从 Domain 页面测试草稿后，任务会出现在这里。</EmptyDescription></EmptyHeader></Empty>
        )}
      </div>
    </Page>
  );
}
