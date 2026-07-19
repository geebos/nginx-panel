import * as React from "react";
import { useRouter } from "next/router";
import { CheckCircle2Icon, CircleAlertIcon, MinusIcon, PlusIcon, RocketIcon, TestTube2Icon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TextDiff } from "@/components/pages/shared/text-diff";
import {
  ApiError,
  deployDomainVersion,
  getDeployment,
  getPublishPreview,
  testDomainVersion,
  type DeploymentDetailResponse,
  type DomainOverviewResponse,
  type PublishPreviewResponse,
} from "@/lib/api";

type PublishStep = "diff" | "test" | "publish";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function CodePanel({ value }: { value: string }) {
  return <pre className="max-h-[48dvh] overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs whitespace-pre">{value}</pre>;
}

function SemanticChanges({ preview }: { preview: PublishPreviewResponse }) {
  if (!preview.changes.length) return <p className="py-10 text-center text-sm text-muted-foreground">当前草稿与线上版本没有语义差异。</p>;
  return (
    <div className="flex max-h-[48dvh] flex-col gap-3 overflow-y-auto pr-1">
      {preview.changes.map((change, index) => {
        const added = change.kind === "added";
        const removed = change.kind === "removed";
        return (
          <div className="rounded-md border border-border bg-card p-4" key={`${change.section}-${change.label}-${index}`}>
            <div className="flex items-center gap-2">
              {added ? <PlusIcon className="text-success" /> : removed ? <MinusIcon className="text-destructive" /> : <CircleAlertIcon className="text-muted-foreground" />}
              <Badge variant={removed ? "destructive" : "outline"}>{change.kind === "changed" ? "Changed" : added ? "Added" : "Removed"}</Badge>
              <span className="font-medium">{change.label}</span>
              <span className="text-xs capitalize text-muted-foreground">{change.section}</span>
            </div>
            {change.before !== undefined || change.after !== undefined ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {change.before !== undefined ? <pre className="overflow-x-auto rounded-md bg-destructive/10 p-3 font-mono text-xs text-destructive"><span aria-hidden="true">- </span>{change.before}</pre> : <div />}
                {change.after !== undefined ? <pre className="overflow-x-auto rounded-md bg-success/10 p-3 font-mono text-xs text-success"><span aria-hidden="true">+ </span>{change.after}</pre> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function PublishDomainDialog({
  domainId,
  data,
  open,
  onOpenChange,
}: {
  domainId: string;
  data: DomainOverviewResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState<PublishStep>("diff");
  const [preview, setPreview] = React.useState<PublishPreviewResponse>();
  const [deployment, setDeployment] = React.useState<DeploymentDetailResponse>();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const requestGeneration = React.useRef(0);
  const previewAbort = React.useRef<AbortController | null>(null);
  const idempotencyKey = React.useRef<string | undefined>(undefined);

  const loadPreview = React.useCallback(async () => {
    if (!data.draftVersion) return;
    previewAbort.current?.abort();
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    previewAbort.current = controller;
    setLoading(true);
    setError(undefined);
    setDeployment(undefined);
    setStep("diff");
    try {
      const result = await getPublishPreview(domainId, data.draftVersion.id, controller.signal);
      if (generation !== requestGeneration.current || result.targetVersion.id !== data.draftVersion.id || result.targetSnapshotChecksum !== data.draftVersion.snapshotChecksum) return;
      setPreview(result);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "发布预览加载失败");
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [data.draftVersion, domainId]);

  React.useEffect(() => {
    if (!open) return;
    // Loading the server-owned preview is the external synchronization this effect manages.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPreview();
    return () => previewAbort.current?.abort();
  }, [loadPreview, open]);

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      requestGeneration.current += 1;
      previewAbort.current?.abort();
      setPreview(undefined);
      setDeployment(undefined);
      setError(undefined);
      setStep("diff");
      idempotencyKey.current = undefined;
    }
    onOpenChange(nextOpen);
  };

  React.useEffect(() => {
    const deploymentId = deployment?.deployment.id;
    if (!open || step !== "test" || !deploymentId || !["queued", "running"].includes(deployment.deployment.status)) return;
    const timer = window.setInterval(() => {
      void getDeployment(deploymentId).then((result) => {
        setDeployment(result);
        if (result.deployment.status === "failed" && result.deployment.errorCode === "DRAFT_CHANGED") {
          setError("草稿已变化，请重新查看 Diff 并测试。");
          setStep("diff");
          void loadPreview();
        }
      }).catch((caught) => setError(caught instanceof Error ? caught.message : "测试状态读取失败"));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deployment, loadPreview, open, step]);

  const startTest = async () => {
    if (!preview) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await testDomainVersion(domainId, preview.targetVersion.id, preview.targetSnapshotChecksum);
      setDeployment(await getDeployment(result.deploymentId));
      setStep("test");
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "DRAFT_CHANGED") void loadPreview();
      setError(caught instanceof Error ? caught.message : "配置测试创建失败");
    } finally {
      setLoading(false);
    }
  };

  const publish = async () => {
    if (!preview || !deployment || deployment.deployment.status !== "succeeded") return;
    setLoading(true);
    setError(undefined);
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const result = await deployDomainVersion(domainId, preview.targetVersion.id, preview.targetSnapshotChecksum, deployment.deployment.id, idempotencyKey.current);
      changeOpen(false);
      await router.push(`/deployments/${result.deploymentId}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "PREFLIGHT_STALE") {
        setStep("diff");
        void loadPreview();
      }
      setError(caught instanceof Error ? caught.message : "发布任务创建失败");
      setLoading(false);
    }
  };

  const testSucceeded = deployment?.deployment.status === "succeeded";
  const failedStep = deployment?.steps.find((item) => item.status === "failed");

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>发布 {data.domain.primaryHostname}</DialogTitle>
          <DialogDescription>Diff → Test → Publish。测试结果与当前草稿 checksum 绑定，发布时仍会重新执行完整 nginx -t。</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2" aria-label="发布步骤">
          {(["diff", "test", "publish"] as const).map((item, index) => <React.Fragment key={item}><Badge variant={step === item ? "default" : "outline"}>{index + 1}. {item === "diff" ? "Diff" : item === "test" ? "Test" : "Publish"}</Badge>{index < 2 ? <span className="text-muted-foreground">/</span> : null}</React.Fragment>)}
        </div>
        {error ? <Alert variant="destructive"><AlertTitle>无法继续发布</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {loading && !preview ? <Skeleton className="h-80" /> : null}
        {step === "diff" && preview ? (
          <Tabs defaultValue="semantic">
            <TabsList><TabsTrigger value="semantic">语义 Diff</TabsTrigger><TabsTrigger value="json">JSON</TabsTrigger><TabsTrigger value="nginx">Nginx</TabsTrigger></TabsList>
            <TabsContent value="semantic"><SemanticChanges preview={preview} /></TabsContent>
            <TabsContent value="json"><div className="grid gap-4 md:grid-cols-2"><CodePanel value={preview.baseJson ?? "# 当前无活跃配置"} /><CodePanel value={preview.targetJson} /></div></TabsContent>
            <TabsContent value="nginx"><TextDiff oldText={preview.baseNginx ?? ""} newText={preview.targetNginx} className="max-h-[48dvh]" /></TabsContent>
          </Tabs>
        ) : null}
        {step === "test" && deployment ? (
          <div className="flex flex-col gap-4">
            <Alert variant={testSucceeded ? "default" : deployment.deployment.status === "failed" ? "destructive" : "default"}>
              {testSucceeded ? <CheckCircle2Icon /> : <TestTube2Icon />}
              <AlertTitle>{testSucceeded ? "配置测试通过" : deployment.deployment.status === "failed" ? "配置测试失败" : "正在测试候选配置"}</AlertTitle>
              <AlertDescription>{testSucceeded ? "测试结果已绑定当前 Version 和 checksum。" : failedStep?.message ?? "系统正在生成候选配置并执行 nginx -t。"}</AlertDescription>
            </Alert>
            {failedStep?.logExcerpt ? <CodePanel value={failedStep.logExcerpt} /> : null}
          </div>
        ) : null}
        {step === "publish" && preview && deployment ? (
          <div className="grid gap-4 rounded-md border border-border bg-card p-5 sm:grid-cols-2">
            <div><p className="text-xs text-muted-foreground">Domain</p><p className="mt-1 font-medium">{data.domain.primaryHostname}</p></div>
            <div><p className="text-xs text-muted-foreground">目标版本</p><p className="mt-1 font-mono">v{preview.targetVersion.versionNumber}</p></div>
            <div><p className="text-xs text-muted-foreground">Checksum</p><p className="mt-1 font-mono text-sm">{preview.targetSnapshotChecksum.slice(0, 12)}</p></div>
            <div><p className="text-xs text-muted-foreground">测试通过时间</p><p className="mt-1 text-sm">{deployment.deployment.finishedAt ? dateFormatter.format(deployment.deployment.finishedAt) : "-"}</p></div>
            <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Diff 摘要</p><p className="mt-1 text-sm">{preview.changes.length} 项语义变化</p></div>
          </div>
        ) : null}
        <DialogFooter>
          {step !== "diff" ? <Button variant="outline" onClick={() => setStep(step === "publish" ? "test" : "diff")} disabled={loading}>上一步</Button> : null}
          {step === "diff" ? <Button onClick={() => void startTest()} disabled={!preview || loading}><TestTube2Icon data-icon="inline-start" />下一步：测试配置</Button> : null}
          {step === "test" && deployment?.deployment.status === "failed" ? <Button variant="outline" onClick={() => changeOpen(false)}>返回编辑</Button> : null}
          {step === "test" && deployment?.deployment.status === "failed" ? <Button onClick={() => void startTest()} disabled={loading}><TestTube2Icon data-icon="inline-start" />重新测试</Button> : null}
          {step === "test" && deployment?.deployment.status !== "failed" ? <Button onClick={() => setStep("publish")} disabled={!testSucceeded}>下一步：确认发布</Button> : null}
          {step === "publish" ? <Button onClick={() => void publish()} disabled={loading}><RocketIcon data-icon="inline-start" />确认发布</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DomainPageActions({ domainId, data, dirty = false }: { domainId: string; data?: DomainOverviewResponse | null; dirty?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const draft = data?.draftVersion;
  const busy = data?.recentDeployments.some((item) => item.type === "deploy" && ["queued", "running"].includes(item.status));
  const reason = !draft
    ? "当前没有待发布草稿"
    : !data?.domain.enabled
      ? "Domain 已停用，请先启用"
      : data.domain.runtimeStatus === "degraded"
        ? "运行时处于 degraded，请先前往 Diagnostics"
        : busy
          ? "已有发布任务正在运行"
          : undefined;

  const button = <Button size="sm" disabled={Boolean(reason)} onClick={() => { if (dirty) { toast.warning("请先保存当前页面的修改，再打开发布向导"); return; } setOpen(true); }}>发布</Button>;
  return (
    <>
      {reason ? <Tooltip><TooltipTrigger asChild><span>{button}</span></TooltipTrigger><TooltipContent>{reason}</TooltipContent></Tooltip> : button}
      {data ? <PublishDomainDialog domainId={domainId} data={data} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
