import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/router";
import { BracesIcon, RefreshCwIcon, SaveIcon, WandSparklesIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { useApiQuery } from "@/hooks/use-api-query";
import { ApiError, createConfigVersion, getDomain } from "@/lib/api";
import { advancedDirectiveNames, parseAdvancedSnippet } from "@/shared/schemas";
import { DomainTabs } from "./domain-tabs";
import { DomainPageActions } from "./domain-page-actions";

function domainIdFromPath(asPath: string) {
  const match = asPath.match(/^\/domains\/([^/?]+)\/advanced/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export function DomainAdvanced() {
  const router = useRouter();
  const domainId = domainIdFromPath(router.asPath);
  const load = React.useCallback(() => getDomain(domainId), [domainId]);
  const query = useApiQuery(load);
  const [snippetOverride, setSnippetOverride] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const data = query.data;
  const config = data?.config;
  const editableVersion = data?.draftVersion ?? data?.activeVersion;
  const snippet = snippetOverride ?? config?.advanced.serverSnippet ?? "";

  const validate = () => {
    try {
      return parseAdvancedSnippet(snippet);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "高级配置格式无效");
      return null;
    }
  };

  const save = async () => {
    if (!config || !editableVersion || !validate()) return null;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createConfigVersion(
        domainId,
        { config: { ...config, advanced: { serverSnippet: snippet } }, changeSummary: "更新高级配置" },
        editableVersion.snapshotChecksum,
      );
      toast.success(result.mode === "created" ? `已创建 v${result.version.versionNumber} 草稿` : result.mode === "updated" ? `已更新 v${result.version.versionNumber} 草稿` : "没有配置变化");
      setSnippetOverride(null);
      await query.refresh();
      return result.version;
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : "高级配置保存失败");
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  if (!router.isReady || !domainId) return <Skeleton className="m-8 h-96" />;

  const dirty = Boolean(config && snippetOverride !== null && snippet !== config.advanced.serverSnippet);

  return (
    <>
      <PageHeader
        title={data ? <span className="flex flex-wrap items-center gap-3">{data.domain.primaryHostname}<StatusBadge status={data.domain.enabled ? data.domain.runtimeStatus : "disabled"} /></span> : "Advanced"}
        description="补充可视化表单尚未覆盖的少量 server 指令。"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Domains", href: "/domains" }, { label: data?.domain.primaryHostname ?? "Domain", href: `/domains/${domainId}/overview` }, { label: "Advanced" }]}
        action={<><Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing || dirty}><RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />刷新</Button><DomainPageActions domainId={domainId} data={data} dirty={dirty} /><Button size="sm" onClick={() => void save()} disabled={!dirty || submitting}><SaveIcon data-icon="inline-start" />{submitting ? "保存中" : "保存草稿"}</Button></>}
      />
      <DomainTabs domainId={domainId} active="advanced" />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 md:px-8">
        <Alert className="border-amber-500/30 bg-amber-500/10"><BracesIcon /><AlertTitle>高级配置可能造成测试或发布失败</AlertTitle><AlertDescription>每行只允许一条白名单指令；禁止 block、include、动态模块及文件或进程相关能力。</AlertDescription></Alert>
        {error || query.error ? <Alert variant="destructive"><AlertTitle>Advanced 操作失败</AlertTitle><AlertDescription>{error ?? query.error?.message}</AlertDescription></Alert> : null}
        {query.loading && !data ? <Skeleton className="h-96" /> : config ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="border border-border">
              <CardHeader><CardTitle>Server snippet</CardTitle><CardDescription>生成在 server 级 Header 之后、业务 location 之前。</CardDescription></CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor="serverSnippet">Nginx directives</FieldLabel>
                  <Textarea id="serverSnippet" className="min-h-80 resize-y font-mono text-xs leading-6" spellCheck={false} value={snippet} onChange={(event) => { setSnippetOverride(event.target.value); setError(null); }} placeholder={"client_max_body_size 20m;\ngzip on;"} />
                  <FieldDescription>最多 16 KiB；指令参数不能包含注释或 block。</FieldDescription>
                  {error ? <FieldError>{error}</FieldError> : null}
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">{snippet.length.toLocaleString()} / 16,384 字符{dirty ? "，有未保存修改" : ""}</span>
                  <Button size="sm" variant="outline" onClick={() => { const lines = validate(); if (lines) setSnippetOverride(lines.join("\n")); }}><WandSparklesIcon data-icon="inline-start" />格式化</Button>
                </div>
              </CardContent>
            </Card>
            <Card className="h-fit border border-border">
              <CardHeader><CardTitle>允许的指令</CardTitle><CardDescription>MVP 白名单，共 {advancedDirectiveNames.length} 项。</CardDescription></CardHeader>
              <CardContent><ul className="flex flex-col gap-2">{advancedDirectiveNames.map((name) => <li className="rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs" key={name}>{name}</li>)}</ul></CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
