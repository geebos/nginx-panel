import * as React from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import {
  cancelManagerCertificateOrder,
  createManagerCertificateOrder,
  getCloudflareCredentials,
  getManagerCertificateOrder,
  getManagerCertificateOrders,
  getManagerCertificates,
  recheckManagerCertificateOrder,
  renewManagerCertificate,
  retryManagerCertificateActivation,
  type CertificateOrderSummary,
  type CertificateSummary,
  type ManagerSettingsResponse,
} from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n/error";
import { LocalizedLink } from "@/components/i18n/localized-link";

type Props = {
  manager: ManagerSettingsResponse;
  onChanged?: () => void;
};

export function ManagerSslForm({ manager, onChanged }: Props) {
  const { t } = useTranslation(["common"]);
  const canIssue = manager.status === "bound" && Boolean(manager.config?.bound);
  const certsQuery = useApiQuery(
    React.useCallback(() => (canIssue ? getManagerCertificates() : Promise.resolve({ domainId: "", items: [] as CertificateSummary[] })), [canIssue]),
  );
  const ordersQuery = useApiQuery(
    React.useCallback(() => (canIssue ? getManagerCertificateOrders() : Promise.resolve({ domainId: "", items: [] as CertificateOrderSummary[] })), [canIssue]),
  );
  const cloudflareQuery = useApiQuery(getCloudflareCredentials);

  const defaultEmail = manager.config?.ssl.email ?? "";
  const defaultEnvironment = manager.config?.ssl.environment ?? "production";
  const [email, setEmail] = React.useState(defaultEmail);
  const [environment, setEnvironment] = React.useState<"staging" | "production">(defaultEnvironment);
  const [provider, setProvider] = React.useState<"manual" | "cloudflare">("manual");
  const [credentialId, setCredentialId] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [activeOrderId, setActiveOrderId] = React.useState<string | null>(null);
  const [orderDetail, setOrderDetail] = React.useState<Awaited<ReturnType<typeof getManagerCertificateOrder>> | null>(null);

  const refreshCerts = certsQuery.refresh;
  const refreshOrders = ordersQuery.refresh;
  React.useEffect(() => {
    if (!activeOrderId || !canIssue) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const detail = await getManagerCertificateOrder(activeOrderId);
        if (cancelled) return;
        setOrderDetail(detail);
        if (["succeeded", "failed", "expired", "cancelled"].includes(detail.order.status)) {
          void refreshCerts();
          void refreshOrders();
          onChanged?.();
          return;
        }
        timer = window.setTimeout(() => void tick(), 2500);
      } catch {
        // keep last detail; user can recheck manually
        if (!cancelled) timer = window.setTimeout(() => void tick(), 2500);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // Intentionally depend on stable refresh fns + order id only (M1).
  }, [activeOrderId, canIssue, refreshCerts, refreshOrders, onChanged]);

  const issue = async () => {
    setError(null);
    setBusy("issue");
    try {
      const validation =
        provider === "cloudflare"
          ? { method: "dns-01" as const, provider: "cloudflare" as const, cloudflareCredentialId: credentialId }
          : { method: "dns-01" as const, provider: "manual" as const };
      if (provider === "cloudflare" && !credentialId) {
        setError(t("common:settings.manager.sslCloudflareCredential"));
        setBusy(null);
        return;
      }
      const result = await createManagerCertificateOrder({
        accountEmail: email.trim(),
        environment,
        validation,
      });
      toast.success(t("common:settings.manager.sslOrderCreated"));
      setActiveOrderId(result.order.id);
      void ordersQuery.refresh();
      onChanged?.();
    } catch (err) {
      setError(formatErrorMessage(t, err, "common:settings.manager.sslOrderFailed"));
    } finally {
      setBusy(null);
    }
  };

  const renew = async () => {
    setError(null);
    setBusy("renew");
    try {
      const result = await renewManagerCertificate();
      toast.success(t("common:settings.manager.sslOrderCreated"));
      setActiveOrderId(result.order.id);
      void ordersQuery.refresh();
    } catch (err) {
      setError(formatErrorMessage(t, err, "common:settings.manager.sslOrderFailed"));
    } finally {
      setBusy(null);
    }
  };

  if (!canIssue) {
    return (
      <Card className="border-border shadow-none">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{t("common:settings.manager.sslTitle")}</CardTitle>
          <CardDescription>{t("common:settings.manager.sslBoundRequired")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const orders = ordersQuery.data?.items ?? [];
  const certs = certsQuery.data?.items ?? [];
  const credentials = cloudflareQuery.data?.items ?? [];
  const activeCert = certs.find((c) => c.status === "active");

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("common:settings.manager.operationFailed")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-border shadow-none">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{t("common:settings.manager.sslTitle")}</CardTitle>
          <CardDescription>{t("common:settings.manager.sslDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="managerSslEmail">{t("common:settings.manager.sslEmail")}</FieldLabel>
              <Input id="managerSslEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>{t("common:settings.manager.sslEnvironment")}</FieldLabel>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={environment === "production" ? "default" : "outline"} onClick={() => setEnvironment("production")}>
                  {t("common:settings.manager.sslEnvironmentProduction")}
                </Button>
                <Button type="button" size="sm" variant={environment === "staging" ? "default" : "outline"} onClick={() => setEnvironment("staging")}>
                  {t("common:settings.manager.sslEnvironmentStaging")}
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel>{t("common:settings.manager.sslValidation")}</FieldLabel>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={provider === "manual" ? "default" : "outline"} onClick={() => setProvider("manual")}>
                  {t("common:settings.manager.sslValidationManual")}
                </Button>
                <Button type="button" size="sm" variant={provider === "cloudflare" ? "default" : "outline"} onClick={() => setProvider("cloudflare")}>
                  {t("common:settings.manager.sslValidationCloudflare")}
                </Button>
              </div>
            </Field>
            {provider === "cloudflare" ? (
              <Field>
                <FieldLabel htmlFor="managerCfCred">{t("common:settings.manager.sslCloudflareCredential")}</FieldLabel>
                <select
                  id="managerCfCred"
                  className="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  value={credentialId}
                  onChange={(e) => setCredentialId(e.target.value)}
                >
                  <option value="">—</option>
                  {credentials.map((cred) => (
                    <option key={cred.id} value={cred.id}>{cred.name}</option>
                  ))}
                </select>
                <FieldDescription>
                  <LocalizedLink className="text-primary underline-offset-4 hover:underline" href="/settings/cloudflare">
                    Cloudflare DNS
                  </LocalizedLink>
                </FieldDescription>
              </Field>
            ) : null}
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2 border-t border-border">
          <Button type="button" disabled={busy !== null || !email.trim()} onClick={() => void issue()}>
            {busy === "issue" ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
            {t("common:settings.manager.sslIssue")}
          </Button>
          {activeCert ? (
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void renew()}>
              {busy === "renew" ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
              {t("common:settings.manager.sslRenew")}
            </Button>
          ) : null}
        </CardFooter>
      </Card>

      <Card className="border-border shadow-none">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{t("common:settings.manager.sslCertsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {certsQuery.loading ? <Skeleton className="h-16 w-full" /> : null}
          {!certsQuery.loading && certs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("common:settings.manager.sslNoCerts")}</p>
          ) : null}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {certs.map((cert) => (
              <li key={cert.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-mono text-foreground">{cert.sans.join(", ")}</p>
                  <p className="text-muted-foreground">
                    {cert.provider} · {cert.environment}
                    {cert.notAfter ? ` · exp ${new Date(cert.notAfter).toISOString().slice(0, 10)}` : ""}
                  </p>
                </div>
                <Badge variant="outline">{cert.status}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-border shadow-none">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{t("common:settings.manager.sslOrdersTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {ordersQuery.loading ? <Skeleton className="h-16 w-full" /> : null}
          {!ordersQuery.loading && orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("common:settings.manager.sslNoOrders")}</p>
          ) : null}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {orders.slice(0, 8).map((order) => (
              <li key={order.id} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-foreground">{order.identifiers.join(", ")}</p>
                    <p className="text-muted-foreground">
                      {order.status}
                      {order.dnsProvider ? ` · ${order.dnsProvider}` : ""}
                      {order.errorMessage ? ` · ${order.errorMessage}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setActiveOrderId(order.id)}>
                      {t("common:settings.manager.sslRecheck")}
                    </Button>
                    {!["succeeded", "failed", "expired", "cancelled"].includes(order.status) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void cancelManagerCertificateOrder(order.id).then(() => ordersQuery.refresh())}
                      >
                        {t("common:settings.manager.sslCancel")}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {activeOrderId === order.id && orderDetail?.order.id === order.id ? (
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    {orderDetail.challenges.filter((ch) => ch.dnsRecordName).length ? (
                      <>
                        <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                          {t("common:settings.manager.sslDnsRecords")}
                        </p>
                        <ul className="space-y-1 font-mono text-xs">
                          {orderDetail.challenges.map((ch) =>
                            ch.dnsRecordName ? (
                              <li key={ch.id}>
                                TXT {ch.dnsRecordName} → {ch.dnsRecordValue}
                              </li>
                            ) : null,
                          )}
                        </ul>
                      </>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void recheckManagerCertificateOrder(order.id).then((r) => {
                          setOrderDetail((prev) => (prev ? { ...prev, order: r.order } : prev));
                          void ordersQuery.refresh();
                        })}
                      >
                        {t("common:settings.manager.sslRecheck")}
                      </Button>
                      {orderDetail.activation && ["failed", "created"].includes(orderDetail.activation.status) ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void retryManagerCertificateActivation(order.id).then(() => {
                            void getManagerCertificateOrder(order.id).then(setOrderDetail);
                            onChanged?.();
                          })}
                        >
                          {t("common:settings.manager.sslRetryActivation")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
