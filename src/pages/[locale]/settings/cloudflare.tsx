import * as React from "react";
import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n/static";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/pages/settings/tabs";
import {
  CloudflareCredentialCard,
  CreateCloudflareCredentialForm,
} from "@/components/pages/settings/forms/cloudflare-credential-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import {
  createCloudflareCredential,
  deleteCloudflareCredential,
  getCloudflareCredentials,
  replaceCloudflareCredentialToken,
} from "@/lib/api";
import { formatErrorMessage } from "@/lib/i18n/error";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common"]);

export default function CloudflareSettingsPage() {
  const { t } = useTranslation(["common"]);
  const query = useApiQuery(getCloudflareCredentials);
  const [submittingId, setSubmittingId] = React.useState<string>();
  const [error, setError] = React.useState<string>();

  const run = async (id: string, action: () => Promise<unknown>, message: string) => {
    setSubmittingId(id);
    setError(undefined);
    try {
      await action();
      toast.success(message);
      await query.refresh();
    } catch (caught) {
      setError(formatErrorMessage(t, caught, "common:settings.cloudflare.operationFailed"));
      throw caught;
    } finally {
      setSubmittingId(undefined);
    }
  };

  return (
    <Page className="px-0 pb-16">
      <PageHeader
        title={t("common:settings.cloudflare.title")}
        description={t("common:settings.cloudflare.description")}
        breadcrumbs={[
          { label: t("common:settings.breadcrumbs.settings"), href: "/settings/nginx" },
          { label: t("common:settings.cloudflare.breadcrumb") },
        ]}
      />
      <SettingsTabs active="cloudflare" />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 md:px-8">
        {error || query.error ? (
          <Alert variant="destructive">
            <AlertTitle>{t("common:settings.cloudflare.operationFailed")}</AlertTitle>
            <AlertDescription>
              {error ?? (query.error ? formatErrorMessage(t, query.error) : null)}
            </AlertDescription>
          </Alert>
        ) : null}
        <CreateCloudflareCredentialForm
          submitting={submittingId === "new"}
          onSubmit={(input) =>
            run("new", () => createCloudflareCredential(input), t("common:settings.cloudflare.saved"))
          }
        />
        {query.loading && !query.data ? (
          <Skeleton className="h-56" />
        ) : (
          query.data?.items.map((credential) => (
            <CloudflareCredentialCard
              key={credential.id}
              credential={credential}
              submitting={submittingId === credential.id}
              onReplace={(token) =>
                run(
                  credential.id,
                  () => replaceCloudflareCredentialToken(credential.id, token),
                  t("common:settings.cloudflare.tokenReplaced"),
                )
              }
              onDelete={() =>
                run(
                  credential.id,
                  () => deleteCloudflareCredential(credential.id),
                  t("common:settings.cloudflare.deleted"),
                )
              }
            />
          ))
        )}
      </div>
    </Page>
  );
}
