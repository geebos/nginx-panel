import * as React from "react";
import { useRouter } from "next/router";
import { useTranslation } from "react-i18next";
import { ActivityIcon, AlertTriangleIcon, ServerCogIcon, ShieldCheckIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActiveRuntimeConfig, getDomains, rebuildActiveRuntime, reloadManagerTls, runDiagnosticNginxTest, type ActiveRuntimeConfig, type RuntimeDiagnostics } from "@/lib/api";
import { useApiQuery } from "@/hooks/use-api-query";
import { useLocale } from "@/hooks/use-locale";
import { formatErrorMessage, formatMessageKey } from "@/lib/i18n/error";
import { localizePath } from "@/lib/i18n/utils";

function formatBytes(value: number | null, notAvailable: string) {
  if (value === null) return notAvailable;
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

export function RuntimeDiagnosticsForm({ diagnostics }: { diagnostics: RuntimeDiagnostics }) {
  const { t } = useTranslation(["common"]);
  const router = useRouter();
  const locale = useLocale();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [reloadingTls, setReloadingTls] = React.useState(false);
  const [testingNginx, setTestingNginx] = React.useState(false);
  const [domainId, setDomainId] = React.useState("");
  const [runtimeConfig, setRuntimeConfig] = React.useState<ActiveRuntimeConfig>();
  const [runtimeConfigError, setRuntimeConfigError] = React.useState<string>();
  const [loadingRuntimeConfig, setLoadingRuntimeConfig] = React.useState(false);
  const loadDomains = React.useCallback(() => getDomains(new URLSearchParams({ page: "1", pageSize: "100", status: "all", sort: "hostname_asc" })), []);
  const domains = useApiQuery(loadDomains);
  const notAvailable = t("common:settings.diagnostics.storage.notAvailable");

  const rebuild = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      const result = await rebuildActiveRuntime(currentPassword);
      await router.push(localizePath(`/deployments/detail?id=${result.deploymentId}`, locale));
    } catch (caught) {
      setError(formatErrorMessage(t, caught, "errors:runtimeConfigRebuildFailed"));
      setSubmitting(false);
    }
  };

  const reloadTls = async () => {
    setError(undefined);
    setReloadingTls(true);
    try {
      const result = await reloadManagerTls();
      await router.push(localizePath(`/deployments/detail?id=${result.deploymentId}`, locale));
    } catch (caught) {
      setError(formatErrorMessage(t, caught, "errors:tlsReloadFailed"));
      setReloadingTls(false);
    }
  };

  const testNginx = async () => {
    setError(undefined);
    setTestingNginx(true);
    try {
      const result = await runDiagnosticNginxTest();
      await router.push(localizePath(`/deployments/detail?id=${result.deploymentId}`, locale));
    } catch (caught) {
      setError(formatErrorMessage(t, caught, "errors:nginxConfigTestFailed"));
      setTestingNginx(false);
    }
  };

  const inspectRuntimeConfig = async (nextDomainId: string | null) => {
    const next = nextDomainId ?? "";
    setDomainId(next);
    setRuntimeConfig(undefined);
    setRuntimeConfigError(undefined);
    if (!next) return;
    setLoadingRuntimeConfig(true);
    try {
      setRuntimeConfig(await getActiveRuntimeConfig(next));
    } catch (caught) {
      setRuntimeConfigError(formatErrorMessage(t, caught, "errors:activeDomainConfigLoadFailed"));
    } finally {
      setLoadingRuntimeConfig(false);
    }
  };

  const runtime = diagnostics.runtime;
  return (
    <form className="flex flex-col gap-6" onSubmit={rebuild}>
      {error ? <Alert variant="destructive"><AlertTitle>{t("common:settings.diagnostics.operationFailed")}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      <Card className="border border-border">
        <CardHeader>
          <CardTitle>{t("common:settings.diagnostics.consistency.title")}</CardTitle>
          <CardDescription>{t("common:settings.diagnostics.consistency.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={runtime.status === "healthy" ? "secondary" : "destructive"}>{runtime.status}</Badge>
            <span className="font-mono text-xs text-muted-foreground">revision {runtime.activeRevision ?? "bootstrap"}</span>
          </div>
          {runtime.issues.length ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>{t("common:settings.diagnostics.consistency.driftTitle")}</AlertTitle>
              <AlertDescription>
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {runtime.issues.map((issue) => <li key={issue.code}>{t("common:settings.diagnostics.consistency.issueItem", { message: formatMessageKey(t, issue.message), code: issue.code })}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          ) : <p className="text-sm text-muted-foreground">{t("common:settings.diagnostics.consistency.healthy")}</p>}
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-3">
          <span className="text-xs text-muted-foreground">{t("common:settings.diagnostics.consistency.workerUptime", { pid: diagnostics.worker.pid, minutes: Math.floor(diagnostics.worker.uptimeSeconds / 60) })}</span>
          <Button type="button" variant="outline" disabled={testingNginx} onClick={() => void testNginx()}>
            {testingNginx ? <Spinner data-icon="inline-start" /> : <ActivityIcon data-icon="inline-start" />}
            {t("common:settings.diagnostics.consistency.runNginxTest")}
          </Button>
        </CardFooter>
      </Card>

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>{t("common:settings.diagnostics.storage.title")}</CardTitle>
          <CardDescription>{t("common:settings.diagnostics.storage.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>{t("common:settings.diagnostics.storage.columnRegion")}</TableHead><TableHead>{t("common:settings.diagnostics.storage.columnStatus")}</TableHead><TableHead>{t("common:settings.diagnostics.storage.columnPath")}</TableHead><TableHead className="text-right">{t("common:settings.diagnostics.storage.columnSize")}</TableHead><TableHead className="text-right">{t("common:settings.diagnostics.storage.columnAvailable")}</TableHead></TableRow></TableHeader>
            <TableBody>
              {diagnostics.storage.map((item) => (
                <TableRow key={item.key}>
                  <TableCell className="font-medium">{item.label}</TableCell>
                  <TableCell><Badge variant={item.status === "available" ? "secondary" : item.status === "unconfigured" ? "outline" : "destructive"}>{item.status}</Badge></TableCell>
                  <TableCell className="max-w-72 truncate font-mono text-xs" title={item.path}>{item.path}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatBytes(item.itemBytes, notAvailable)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatBytes(item.filesystem?.availableBytes ?? null, notAvailable)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {diagnostics.logRoots.historical.length ? (
            <Alert className="mt-4">
              <AlertTriangleIcon />
              <AlertTitle>{t("common:settings.diagnostics.storage.historicalTitle")}</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <p>{t("common:settings.diagnostics.storage.historicalDescription")}</p>
                {diagnostics.logRoots.historical.map((root) => <code key={root.path} className="break-all text-xs">{root.path} ({root.readable ? t("common:settings.diagnostics.storage.readable") : t("common:settings.diagnostics.storage.unreadable")})</code>)}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>{t("common:settings.diagnostics.activeDomain.title")}</CardTitle>
          <CardDescription>{t("common:settings.diagnostics.activeDomain.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel>{t("common:settings.diagnostics.activeDomain.domainLabel")}</FieldLabel>
            <Select
              options={(domains.data?.items ?? []).filter((domain) => domain.activeVersionId).map((domain) => ({ value: domain.id, label: domain.primaryHostname, description: domain.activeVersionId ?? undefined }))}
              emptyText={t("common:settings.diagnostics.activeDomain.emptyPublished")}
              placeholder={domains.loading ? t("common:settings.diagnostics.activeDomain.loadingDomains") : t("common:settings.diagnostics.activeDomain.selectDomain")}
              value={domainId}
              onChange={(value) => void inspectRuntimeConfig(value)}
            />
            {domains.error ? <FieldDescription>{t("errors:domainListLoadFailed")}：{formatErrorMessage(t, domains.error)}</FieldDescription> : null}
          </Field>
          {runtimeConfigError ? <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>{t("common:settings.diagnostics.activeDomain.configLoadFailed")}</AlertTitle><AlertDescription>{runtimeConfigError}</AlertDescription></Alert> : null}
          {loadingRuntimeConfig ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />{t("common:settings.diagnostics.activeDomain.readingRevision")}</div> : null}
          {runtimeConfig ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div><p className="text-xs text-muted-foreground">{t("common:settings.diagnostics.activeDomain.revisionFile")}</p><p className="break-all font-mono text-xs">{runtimeConfig.file}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("common:settings.diagnostics.activeDomain.sourceVersion")}</p><p className="break-all font-mono text-xs">{runtimeConfig.inputs.sourceVersionId}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("common:settings.diagnostics.activeDomain.sourceChecksum")}</p><p className="break-all font-mono text-xs">{runtimeConfig.checksums.source}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("common:settings.diagnostics.activeDomain.configChecksum")}</p><p className="break-all font-mono text-xs">{runtimeConfig.checksums.config}</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{t("common:settings.diagnostics.activeDomain.routesBadge", { count: runtimeConfig.inputs.routes })}</Badge>
                <Badge variant="outline">{t("common:settings.diagnostics.activeDomain.headersBadge", { count: runtimeConfig.inputs.headers })}</Badge>
                <Badge variant="outline">{t("common:settings.diagnostics.activeDomain.logsBadge", { revision: runtimeConfig.inputs.logSettingsRevision })}</Badge>
                <Badge variant={runtimeConfig.inputs.enabled ? "secondary" : "outline"}>{runtimeConfig.inputs.enabled ? t("common:settings.diagnostics.activeDomain.enabled") : t("common:settings.diagnostics.activeDomain.disabled")}</Badge>
              </div>
              <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted p-4 font-mono text-xs leading-5"><code>{runtimeConfig.config}</code></pre>
            </div>
          ) : !domainId && !domains.loading ? <p className="text-sm text-muted-foreground">{t("common:settings.diagnostics.activeDomain.selectHint")}</p> : null}
        </CardContent>
      </Card>

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>{t("common:settings.diagnostics.managerTls.title")}</CardTitle>
          <CardDescription>{t("common:settings.diagnostics.managerTls.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={diagnostics.managerTls.status === "valid" ? "secondary" : diagnostics.managerTls.status === "invalid" ? "destructive" : "outline"}>{diagnostics.managerTls.status}</Badge>
            {diagnostics.managerTls.certificate ? <span className="font-mono text-xs text-muted-foreground">{t("common:settings.diagnostics.managerTls.validTo", { date: new Date(diagnostics.managerTls.certificate.validTo).toLocaleString(locale) })}</span> : null}
          </div>
          {diagnostics.managerTls.certificate ? (
            <dl className="grid gap-3 text-sm md:grid-cols-[140px_1fr]">
              <dt className="text-muted-foreground">{t("common:settings.diagnostics.managerTls.hostname")}</dt><dd className="break-all font-mono">{diagnostics.managerTls.certificate.hostname}</dd>
              <dt className="text-muted-foreground">{t("common:settings.diagnostics.managerTls.san")}</dt><dd className="break-all font-mono">{diagnostics.managerTls.certificate.subjectAltName}</dd>
              <dt className="text-muted-foreground">{t("common:settings.diagnostics.managerTls.sha256")}</dt><dd className="break-all font-mono">{diagnostics.managerTls.certificate.fingerprint256}</dd>
            </dl>
          ) : diagnostics.managerTls.error ? <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>{t("common:settings.diagnostics.managerTls.certCheckFailed")}</AlertTitle><AlertDescription>{t(diagnostics.managerTls.error)}</AlertDescription></Alert> : <p className="text-sm text-muted-foreground">{t("common:settings.diagnostics.managerTls.notManaged")}</p>}
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="button" variant="outline" disabled={diagnostics.managerTls.status === "unavailable" || reloadingTls} onClick={() => void reloadTls()}>
            {reloadingTls ? <Spinner data-icon="inline-start" /> : <ShieldCheckIcon data-icon="inline-start" />}
            {t("common:settings.diagnostics.managerTls.reload")}
          </Button>
        </CardFooter>
      </Card>

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>{t("common:settings.diagnostics.rebuild.title")}</CardTitle>
          <CardDescription>{t("common:settings.diagnostics.rebuild.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-disabled={!diagnostics.rebuildAvailable || submitting || undefined}>
              <FieldLabel htmlFor="rebuild-current-password">{t("common:settings.diagnostics.rebuild.passwordLabel")}</FieldLabel>
              <Input id="rebuild-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={!diagnostics.rebuildAvailable || submitting} />
              <FieldDescription>{t("common:settings.diagnostics.rebuild.passwordDescription")}</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" variant="destructive" disabled={!diagnostics.rebuildAvailable || !currentPassword || submitting}>
            {submitting ? <Spinner data-icon="inline-start" /> : <ServerCogIcon data-icon="inline-start" />}
            {t("common:settings.diagnostics.rebuild.submit")}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
