import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "@/hooks/use-router";
import { toast } from "sonner";
import { BracesIcon, RefreshCwIcon, SaveIcon, WandSparklesIcon } from "lucide-react";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DomainPageActions } from "@/components/pages/domains/page-actions";
import { DomainTabs } from "@/components/pages/domains/tabs";
import { StatusBadge } from "@/components/pages/shared/status-badge";
import { useApiQuery } from "@/hooks/use-api-query";
import { createConfigVersion, getDomain } from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n/error";
import { advancedDirectiveNames, parseAdvancedSnippet } from "@/shared/schemas";

function DomainAdvanced({ domainId }: { domainId: string }) {
  const { t } = useTranslation(["common", "domains"]);
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
      setError(formatErrorMessage(t, nextError, "domains:advanced.invalidFormat"));
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
        { config: { ...config, advanced: { serverSnippet: snippet } }, changeSummary: t("domains:advanced.changeSummary") },
        editableVersion.snapshotChecksum,
      );
      toast.success(result.mode === "created" ? t("domains:common.toast.draftCreated", { n: result.version.versionNumber }) : result.mode === "updated" ? t("domains:common.toast.draftUpdated", { n: result.version.versionNumber }) : t("domains:common.toast.noChange"));
      setSnippetOverride(null);
      await query.refresh();
      return result.version;
    } catch (nextError) {
      setError(formatErrorMessage(t, nextError, "domains:advanced.saveFailed"));
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  const dirty = Boolean(config && snippetOverride !== null && snippet !== config.advanced.serverSnippet);

  return (
    <>
      <PageHeader
        title={data ? <span className="flex flex-wrap items-center gap-3">{data.domain.primaryHostname}<StatusBadge status={data.domain.enabled ? data.domain.runtimeStatus : "disabled"} /></span> : t("domains:advanced.titleFallback")}
        description={t("domains:advanced.description")}
        breadcrumbs={[{ label: t("domains:common.breadcrumbs.domains"), href: "/domains" }, { label: data?.domain.primaryHostname ?? t("domains:common.breadcrumbs.domain"), href: `/domains/overview?id=${domainId}` }, { label: t("domains:common.breadcrumbs.advanced") }]}
        action={<><Button size="sm" variant="outline" onClick={() => void query.refresh()} disabled={query.refreshing || dirty}><RefreshCwIcon data-icon="inline-start" className={query.refreshing ? "animate-spin" : undefined} />{t("domains:common.actions.refresh")}</Button><DomainPageActions domainId={domainId} data={data} dirty={dirty} /><Button size="sm" onClick={() => void save()} disabled={!dirty || submitting}><SaveIcon data-icon="inline-start" />{submitting ? t("domains:common.actions.saving") : t("domains:advanced.saveDraft")}</Button></>}
      />
      <DomainTabs domainId={domainId} active="advanced" />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 md:px-8">
        <Alert className="border-amber-500/30 bg-amber-500/10"><BracesIcon /><AlertTitle>{t("domains:advanced.warningTitle")}</AlertTitle><AlertDescription>{t("domains:advanced.warningDescription")}</AlertDescription></Alert>
        {error || query.error ? <Alert variant="destructive"><AlertTitle>{t("domains:advanced.loadFailed")}</AlertTitle><AlertDescription>{error ?? (query.error ? formatErrorMessage(t, query.error) : null)}</AlertDescription></Alert> : null}
        {query.loading && !data ? <Skeleton className="h-96" /> : config ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="border border-border">
              <CardHeader><CardTitle>{t("domains:advanced.snippetCard.title")}</CardTitle><CardDescription>{t("domains:advanced.snippetCard.description")}</CardDescription></CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor="serverSnippet">{t("domains:advanced.snippetCard.label")}</FieldLabel>
                  <Textarea id="serverSnippet" className="min-h-80 resize-y font-mono text-xs leading-6" spellCheck={false} value={snippet} onChange={(event) => { setSnippetOverride(event.target.value); setError(null); }} placeholder={"client_max_body_size 20m;\ngzip on;"} />
                  <FieldDescription>{t("domains:advanced.snippetCard.fieldDescription")}</FieldDescription>
                  {error ? <FieldError>{error}</FieldError> : null}
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">{t("domains:advanced.snippetCard.counter", { count: snippet.length.toLocaleString() })}{dirty ? t("domains:advanced.snippetCard.dirty") : ""}</span>
                  <Button size="sm" variant="outline" onClick={() => { const lines = validate(); if (lines) setSnippetOverride(lines.join("\n")); }}><WandSparklesIcon data-icon="inline-start" />{t("domains:common.actions.format")}</Button>
                </div>
              </CardContent>
            </Card>
            <Card className="h-fit border border-border">
              <CardHeader><CardTitle>{t("domains:advanced.allowCard.title")}</CardTitle><CardDescription>{t("domains:advanced.allowCard.description", { count: advancedDirectiveNames.length })}</CardDescription></CardHeader>
              <CardContent><ul className="flex flex-col gap-2">{advancedDirectiveNames.map((name) => <li className="rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs" key={name}>{name}</li>)}</ul></CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "domains"]);

export default function DomainAdvancedPage() {
  const router = useRouter();
  const domainId = typeof router.query.id === "string" ? router.query.id : "";
  if (!router.isReady || !domainId) return <Page className="px-0 pb-16"><Skeleton className="m-8 h-96" /></Page>;
  return <Page className="px-0 pb-16"><DomainAdvanced domainId={domainId} /></Page>;
}
