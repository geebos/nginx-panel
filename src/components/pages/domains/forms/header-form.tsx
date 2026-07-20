import * as React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { HeaderConfig, RouteConfig } from "@/shared/schemas";
import { randomUUID } from "@/lib/utils";

function buildHeaderFormSchema(t: TFunction) {
  return z.object({
    name: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, t("domains:forms.headerForm.validations.nameFormat")),
    value: z.string().max(4096).refine((value) => !/[\r\n\0]/.test(value), t("domains:forms.headerForm.validations.valueInvalid")),
    scope: z.string().min(1),
    always: z.boolean(),
    enabled: z.boolean(),
  });
}

type HeaderFormValues = z.infer<ReturnType<typeof buildHeaderFormSchema>>;

export function HeaderForm({
  header,
  preset,
  routes,
  sslEnabled,
  submitting,
  onCancel,
  onSubmit,
}: {
  header?: HeaderConfig;
  preset?: Pick<HeaderConfig, "name" | "value" | "always">;
  routes: RouteConfig[];
  sslEnabled: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (header: HeaderConfig) => Promise<void>;
}) {
  const { t } = useTranslation(["common", "domains"]);
  const headerFormSchema = React.useMemo(() => buildHeaderFormSchema(t), [t]);
  const form = useForm<HeaderFormValues>({
    resolver: zodResolver(headerFormSchema),
    defaultValues: {
      name: header?.name ?? preset?.name ?? "",
      value: header?.value ?? preset?.value ?? "",
      scope: header?.scope.type === "route" ? `route:${header.scope.routeId}` : "server",
      always: header?.always ?? preset?.always ?? false,
      enabled: header?.enabled ?? true,
    },
  });
  const name = useWatch({ control: form.control, name: "name" });

  const submit = form.handleSubmit(async (values) => {
    if (values.name.toLowerCase() === "strict-transport-security" && !sslEnabled) {
      form.setError("name", { message: t("domains:forms.headerForm.validations.hstsRequiresHttps") });
      return;
    }
    const routeId = values.scope.startsWith("route:") ? values.scope.slice(6) : null;
    await onSubmit({
      id: header?.id ?? randomUUID(),
      name: values.name,
      value: values.value,
      scope: routeId ? { type: "route", routeId } : { type: "server" },
      always: values.always,
      enabled: values.enabled,
    });
  });

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <FieldGroup>
        <Field data-invalid={Boolean(form.formState.errors.name)}>
          <FieldLabel htmlFor="headerName">{t("domains:forms.headerForm.name")}</FieldLabel>
          <Input id="headerName" aria-invalid={Boolean(form.formState.errors.name)} placeholder="X-Content-Type-Options" {...form.register("name")} />
          <FieldError errors={[form.formState.errors.name]} />
        </Field>
        <Field data-invalid={Boolean(form.formState.errors.value)}>
          <FieldLabel htmlFor="headerValue">{t("domains:forms.headerForm.value")}</FieldLabel>
          <Input id="headerValue" aria-invalid={Boolean(form.formState.errors.value)} placeholder="nosniff" {...form.register("value")} />
          <FieldDescription>{t("domains:forms.headerForm.valueDesc")}</FieldDescription>
          <FieldError errors={[form.formState.errors.value]} />
        </Field>
        <Controller control={form.control} name="scope" render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="headerScope">{t("domains:forms.headerForm.scope")}</FieldLabel>
            <Select
              id="headerScope"
              options={[
                { value: "server", label: t("domains:forms.headerForm.scopeServer") },
                ...routes.map((route) => ({ value: `route:${route.id}`, label: t("domains:forms.headerForm.scopeRoute", { path: route.path }) })),
              ]}
              value={field.value}
              onChange={field.onChange}
            />
            <FieldDescription>{t("domains:forms.headerForm.scopeDesc")}</FieldDescription>
          </Field>
        )} />
        <Controller control={form.control} name="always" render={({ field }) => (
          <Field orientation="horizontal"><FieldContent><FieldTitle>{t("domains:forms.headerForm.always")}</FieldTitle><FieldDescription>{t("domains:forms.headerForm.alwaysDesc")}</FieldDescription></FieldContent><Switch checked={field.value} onCheckedChange={field.onChange} /></Field>
        )} />
        <Controller control={form.control} name="enabled" render={({ field }) => (
          <Field orientation="horizontal"><FieldContent><FieldTitle>{t("domains:forms.headerForm.enabled")}</FieldTitle><FieldDescription>{t("domains:forms.headerForm.enabledDesc")}</FieldDescription></FieldContent><Switch checked={field.value} onCheckedChange={field.onChange} /></Field>
        )} />
      </FieldGroup>
      {name.toLowerCase() === "strict-transport-security" ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground">
          {t("domains:forms.headerForm.hstsWarning")}
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>{t("domains:common.actions.cancel")}</Button>
        <Button type="submit" disabled={submitting}>{submitting ? t("domains:common.actions.saving") : t("domains:forms.headerForm.saveToDraft")}</Button>
      </DialogFooter>
    </form>
  );
}
