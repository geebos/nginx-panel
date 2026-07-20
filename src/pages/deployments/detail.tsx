import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { CheckCircle2Icon, CircleDashedIcon, LoaderCircleIcon, XCircleIcon } from "lucide-react";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { useApiQuery } from "@/hooks/use-api-query";
import { getDeployment } from "@/lib/api";

function StepIcon({ status }: { status: string }) {
  if (status === "succeeded") return <CheckCircle2Icon className="text-foreground" />;
  if (status === "failed") return <XCircleIcon className="text-destructive" />;
  if (status === "running") return <LoaderCircleIcon className="animate-spin text-primary" />;
  return <CircleDashedIcon className="text-muted-foreground" />;
}

export default function DeploymentDetailPage() {
  const router = useRouter();
  const deploymentId = typeof router.query.id === "string" ? router.query.id : "";
  const load = React.useCallback(() => getDeployment(deploymentId), [deploymentId]);
  const query = useApiQuery(load);
  const refresh = query.refresh;
  const status = query.data?.deployment.status;

  React.useEffect(() => {
    if (!status || !["queued", "running"].includes(status)) return;
    const timeout = window.setTimeout(() => void refresh(), 1000);
    return () => window.clearTimeout(timeout);
  }, [refresh, status]);

  if (!router.isReady || !deploymentId) return <Skeleton className="m-8 h-96" />;
  const deployment = query.data?.deployment;
  return (
    <Page className="px-0 pb-16">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">Deployment <span className="font-mono text-lg">{deploymentId.slice(0, 8)}</span>{deployment ? <StatusBadge status={deployment.status} /> : null}</span>}
        description={deployment ? `${deployment.type} · ${deployment.configVersionId ? `Version ${deployment.configVersionId.slice(0, 8)}` : "Global task"}` : "读取任务状态。"}
        breadcrumbs={[{ label: "Deployments", href: "/deployments" }, { label: deploymentId.slice(0, 8) }]}
        action={deployment?.domainId ? <Button size="sm" variant="outline" asChild><Link href={`/domains/overview?id=${deployment.domainId}`}>返回 Domain</Link></Button> : undefined}
      />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 md:px-8">
        {query.error ? <Alert variant="destructive"><AlertTitle>任务加载失败</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert> : null}
        {deployment?.status === "failed" ? <Alert variant="destructive"><AlertTitle>{deployment.errorCode ?? "任务失败"}</AlertTitle><AlertDescription>{deployment.errorMessage ?? "线上配置未改变。"}</AlertDescription></Alert> : null}
        {query.loading && !query.data ? <Skeleton className="h-96" /> : query.data ? (
          <Card className="border border-border"><CardHeader><CardTitle>{deployment?.type === "test" ? "配置测试" : "任务步骤"}</CardTitle><CardDescription>状态由 Worker 返回，页面不会推断任务结果。</CardDescription></CardHeader><CardContent className="flex flex-col">
            {query.data.steps.map((step, index) => (
              <div className="grid grid-cols-[24px_1fr] gap-3 pb-5 last:pb-0" key={step.id}>
                <div className="flex flex-col items-center"><StepIcon status={step.status} />{index < query.data!.steps.length - 1 ? <span className="mt-1 h-full w-px bg-border" /> : null}</div>
                <div className="min-w-0 pb-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{step.name}</p><StatusBadge status={step.status} /></div>{step.message ? <p className="mt-1 text-sm text-muted-foreground">{step.message}</p> : null}{step.logExcerpt ? <Collapsible className="mt-2"><CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-4 hover:underline">查看脱敏日志</CollapsibleTrigger><CollapsibleContent><pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap">{step.logExcerpt}</pre></CollapsibleContent></Collapsible> : null}</div>
              </div>
            ))}
          </CardContent></Card>
        ) : null}
      </div>
    </Page>
  );
}
