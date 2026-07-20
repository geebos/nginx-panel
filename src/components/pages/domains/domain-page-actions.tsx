import * as React from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/router";
import { useLocale } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n-utils";
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
import { formatErrorMessage } from "@/lib/i18n-error";

type PublishStep = "diff" | "test" | "publish";

function CodePanel({ value }: { value: string }) {
  return <pre className="max-h-[48dvh] overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs whitespace-pre">{value}</pre>;
}

function SemanticChanges({ preview }: { preview: PublishPreviewResponse }) {
  const { t } = useTranslation(["common", "domains"]);
  if (!preview.changes.length) return <p className="py-10 text-center text-sm text-muted-foreground">{t("domains:publish.noChanges")}</p>;
  return (
    <div className="flex max-h-[48dvh] flex-col gap-3 overflow-y-auto pr-1">
      {preview.changes.map((change, index) => {
        const added = change.kind === "added";
        const removed = change.kind === "removed";
        return (
          <div className="rounded-md border border-border bg-card p-4" key={`${change.section}-${change.label}-${index}`}>
            <div className="flex items-center gap-2">
              {added ? <PlusIcon className="text-success" /> : removed ? <MinusIcon className="text-destructive" /> : <CircleAlertIcon className="text-muted-foreground" />}
              <Badge variant={removed ? "destructive" : "outline"}>{change.kind === "changed" ? t("domains:publish.badgeChanged") : added ? t("domains:publish.badgeAdded") : t("domains:publish.badgeRemoved")}</Badge>
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
  const { t } = useTranslation(["common", "domains"]);
  const router = useRouter();
  const locale = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const [step, setStep] = React.useState<PublishStep>("diff");
  const [preview, setPreview] = React.useState<PublishPreviewResponse>();
  const [deployment, setDeployment] = React.useState<DeploymentDetailResponse>();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const requestGeneration = React.useRef(0);
  const previewAbort = React.useRef<AbortController | null>(null);
  const idempotencyKey = React.useRef<string | undefined>(undefined);

  // t() from useTranslation blocks React Compiler memo preservation; the callback
  // stays correct (t is stable per locale), the compiler just skips optimizing it.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
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
      if (!controller.signal.aborted) setError(formatErrorMessage(t, caught, "domains:publish.errors.previewFailed"));
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [data.draftVersion, domainId, t]);

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
          setError(t("domains:publish.errors.draftChanged"));
          setStep("diff");
          void loadPreview();
        }
      }).catch((caught) => setError(formatErrorMessage(t, caught, "domains:publish.errors.testStatusFailed")));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deployment, loadPreview, open, step, t]);

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
      setError(formatErrorMessage(t, caught, "domains:publish.errors.testCreateFailed"));
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
      await router.push(localizePath(`/deployments/detail?id=${result.deploymentId}`, locale));
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "PREFLIGHT_STALE") {
        setStep("diff");
        void loadPreview();
      }
      setError(formatErrorMessage(t, caught, "domains:publish.errors.publishCreateFailed"));
      setLoading(false);
    }
  };

  const testSucceeded = deployment?.deployment.status === "succeeded";
  const failedStep = deployment?.steps.find((item) => item.status === "failed");

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("domains:publish.dialogTitle", { hostname: data.domain.primaryHostname })}</DialogTitle>
          <DialogDescription>{t("domains:publish.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2" aria-label={t("domains:publish.stepsAria")}>
          {(["diff", "test", "publish"] as const).map((item, index) => <React.Fragment key={item}><Badge variant={step === item ? "default" : "outline"}>{index + 1}. {item === "diff" ? t("domains:publish.stepDiff") : item === "test" ? t("domains:publish.stepTest") : t("domains:publish.stepPublish")}</Badge>{index < 2 ? <span className="text-muted-foreground">/</span> : null}</React.Fragment>)}
        </div>
        {error ? <Alert variant="destructive"><AlertTitle>{t("domains:publish.cannotContinue")}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {loading && !preview ? <Skeleton className="h-80" /> : null}
        {step === "diff" && preview ? (
          <Tabs defaultValue="semantic">
            <TabsList><TabsTrigger value="semantic">{t("domains:publish.tabSemantic")}</TabsTrigger><TabsTrigger value="json">{t("domains:publish.tabJson")}</TabsTrigger><TabsTrigger value="nginx">{t("domains:publish.tabNginx")}</TabsTrigger></TabsList>
            <TabsContent value="semantic"><SemanticChanges preview={preview} /></TabsContent>
            <TabsContent value="json"><div className="grid gap-4 md:grid-cols-2"><CodePanel value={preview.baseJson ?? t("domains:publish.noActiveConfig")} /><CodePanel value={preview.targetJson} /></div></TabsContent>
            <TabsContent value="nginx"><TextDiff oldText={preview.baseNginx ?? ""} newText={preview.targetNginx} className="max-h-[48dvh]" /></TabsContent>
          </Tabs>
        ) : null}
        {step === "test" && deployment ? (
          <div className="flex flex-col gap-4">
            <Alert variant={testSucceeded ? "default" : deployment.deployment.status === "failed" ? "destructive" : "default"}>
              {testSucceeded ? <CheckCircle2Icon /> : <TestTube2Icon />}
              <AlertTitle>{testSucceeded ? t("domains:publish.testPassed") : deployment.deployment.status === "failed" ? t("domains:publish.testFailed") : t("domains:publish.testing")}</AlertTitle>
              <AlertDescription>{testSucceeded ? t("domains:publish.testPassedDesc") : failedStep?.message ?? t("domains:publish.testingDesc")}</AlertDescription>
            </Alert>
            {failedStep?.logExcerpt ? <CodePanel value={failedStep.logExcerpt} /> : null}
          </div>
        ) : null}
        {step === "publish" && preview && deployment ? (
          <div className="grid gap-4 rounded-md border border-border bg-card p-5 sm:grid-cols-2">
            <div><p className="text-xs text-muted-foreground">{t("domains:publish.summaryCard.domain")}</p><p className="mt-1 font-medium">{data.domain.primaryHostname}</p></div>
            <div><p className="text-xs text-muted-foreground">{t("domains:publish.summaryCard.targetVersion")}</p><p className="mt-1 font-mono">v{preview.targetVersion.versionNumber}</p></div>
            <div><p className="text-xs text-muted-foreground">{t("domains:publish.summaryCard.checksum")}</p><p className="mt-1 font-mono text-sm">{preview.targetSnapshotChecksum.slice(0, 12)}</p></div>
            <div><p className="text-xs text-muted-foreground">{t("domains:publish.summaryCard.testPassedAt")}</p><p className="mt-1 text-sm">{deployment.deployment.finishedAt ? dateFormatter.format(deployment.deployment.finishedAt) : "-"}</p></div>
            <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">{t("domains:publish.summaryCard.diffSummary")}</p><p className="mt-1 text-sm">{t("domains:publish.summaryCard.changesCount", { count: preview.changes.length })}</p></div>
          </div>
        ) : null}
        <DialogFooter>
          {step !== "diff" ? <Button variant="outline" onClick={() => setStep(step === "publish" ? "test" : "diff")} disabled={loading}>{t("domains:publish.previousStep")}</Button> : null}
          {step === "diff" ? <Button onClick={() => void startTest()} disabled={!preview || loading}><TestTube2Icon data-icon="inline-start" />{t("domains:publish.nextTest")}</Button> : null}
          {step === "test" && deployment?.deployment.status === "failed" ? <Button variant="outline" onClick={() => changeOpen(false)}>{t("domains:publish.backToEdit")}</Button> : null}
          {step === "test" && deployment?.deployment.status === "failed" ? <Button onClick={() => void startTest()} disabled={loading}><TestTube2Icon data-icon="inline-start" />{t("domains:publish.retest")}</Button> : null}
          {step === "test" && deployment?.deployment.status !== "failed" ? <Button onClick={() => setStep("publish")} disabled={!testSucceeded}>{t("domains:publish.nextPublish")}</Button> : null}
          {step === "publish" ? <Button onClick={() => void publish()} disabled={loading}><RocketIcon data-icon="inline-start" />{t("domains:publish.confirmPublish")}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DomainPageActions({ domainId, data, dirty = false }: { domainId: string; data?: DomainOverviewResponse | null; dirty?: boolean }) {
  const { t } = useTranslation(["common", "domains"]);
  const [open, setOpen] = React.useState(false);
  const draft = data?.draftVersion;
  const busy = data?.recentDeployments.some((item) => item.type === "deploy" && ["queued", "running"].includes(item.status));
  const reason = !draft
    ? t("domains:publish.reasons.noDraft")
    : !data?.domain.enabled
      ? t("domains:publish.reasons.disabled")
      : data.domain.runtimeStatus === "degraded"
        ? t("domains:publish.reasons.degraded")
        : busy
          ? t("domains:publish.reasons.busy")
          : undefined;

  const button = <Button size="sm" disabled={Boolean(reason)} onClick={() => { if (dirty) { toast.warning(t("domains:publish.dirtyWarning")); return; } setOpen(true); }}>{t("domains:publish.publishButton")}</Button>;
  return (
    <>
      {reason ? <Tooltip><TooltipTrigger asChild><span>{button}</span></TooltipTrigger><TooltipContent>{reason}</TooltipContent></Tooltip> : button}
      {data ? <PublishDomainDialog domainId={domainId} data={data} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
