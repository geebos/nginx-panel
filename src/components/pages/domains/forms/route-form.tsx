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
import type { RouteConfig } from "@/shared/schemas";
import { randomUUID } from "@/lib/utils";

function buildRouteFormSchema(t: TFunction) {
  return z.object({
    type: z.enum(["proxy", "static", "redirect"]),
    path: z.string().trim().min(1, t("domains:forms.routeForm.validations.pathRequired")).startsWith("/", t("domains:forms.routeForm.validations.pathStart")),
    target: z.string(),
    root: z.string(),
    index: z.string(),
    statusCode: z.enum(["301", "302"]),
    enabled: z.boolean(),
    websocket: z.boolean(),
    preserveHost: z.boolean(),
    spaFallback: z.boolean(),
    connectTimeoutSeconds: z.number().int().min(1).max(3600),
    readTimeoutSeconds: z.number().int().min(1).max(3600),
    sendTimeoutSeconds: z.number().int().min(1).max(3600),
  }).superRefine((value, ctx) => {
    if (["proxy", "redirect"].includes(value.type)) {
      const parsed = z.url().safeParse(value.target);
      if (!parsed.success || !/^https?:\/\//i.test(value.target)) {
        ctx.addIssue({ code: "custom", path: ["target"], message: t("domains:forms.routeForm.validations.targetUrl") });
      }
    }
    if (value.type === "static" && !value.root.startsWith("/")) {
      ctx.addIssue({ code: "custom", path: ["root"], message: t("domains:forms.routeForm.validations.staticRoot") });
    }
  });
}

type RouteFormValues = z.infer<ReturnType<typeof buildRouteFormSchema>>;

function defaults(route?: RouteConfig): RouteFormValues {
  return {
    type: route?.type ?? "proxy",
    path: route?.path ?? "/",
    target: route && (route.type === "proxy" || route.type === "redirect") ? route.target : "http://app:3000",
    root: route?.type === "static" ? route.root : "/srv/sites/",
    index: route?.type === "static" ? route.index : "index.html",
    statusCode: route?.type === "redirect" ? String(route.statusCode) as "301" | "302" : "301",
    enabled: route?.enabled ?? true,
    websocket: route?.type === "proxy" ? route.websocket : false,
    preserveHost: route?.type === "proxy" ? route.preserveHost : true,
    spaFallback: route?.type === "static" ? route.spaFallback : false,
    connectTimeoutSeconds: route?.type === "proxy" ? route.connectTimeoutSeconds : 60,
    readTimeoutSeconds: route?.type === "proxy" ? route.readTimeoutSeconds : 60,
    sendTimeoutSeconds: route?.type === "proxy" ? route.sendTimeoutSeconds : 60,
  };
}

export function RouteForm({
  route,
  existingPaths,
  submitting,
  onCancel,
  onSubmit,
}: {
  route?: RouteConfig;
  existingPaths: string[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (route: RouteConfig) => Promise<void>;
}) {
  const { t } = useTranslation(["common", "domains"]);
  const routeFormSchema = React.useMemo(() => buildRouteFormSchema(t), [t]);
  const form = useForm<RouteFormValues>({ resolver: zodResolver(routeFormSchema), defaultValues: defaults(route) });
  const routeType = useWatch({ control: form.control, name: "type" });
  const path = useWatch({ control: form.control, name: "path" });
  const target = useWatch({ control: form.control, name: "target" });

  const submit = form.handleSubmit(async (values) => {
    if (existingPaths.some((item) => item === values.path && item !== route?.path)) {
      form.setError("path", { message: t("domains:forms.routeForm.validations.pathDuplicate") });
      return;
    }
    const base = { id: route?.id ?? randomUUID(), path: values.path, enabled: values.enabled, order: route?.order ?? existingPaths.length };
    const next: RouteConfig = values.type === "proxy"
      ? {
          ...base,
          type: "proxy",
          target: values.target,
          websocket: values.websocket,
          preserveHost: values.preserveHost,
          connectTimeoutSeconds: values.connectTimeoutSeconds,
          readTimeoutSeconds: values.readTimeoutSeconds,
          sendTimeoutSeconds: values.sendTimeoutSeconds,
        }
      : values.type === "static"
        ? { ...base, type: "static", root: values.root, index: values.index, spaFallback: values.spaFallback }
        : { ...base, type: "redirect", target: values.target, statusCode: Number(values.statusCode) as 301 | 302 };
    await onSubmit(next);
  });

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <FieldGroup>
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="routeType">{t("domains:forms.routeForm.type")}</FieldLabel>
              <Select
                id="routeType"
                options={[
                  { value: "proxy", label: t("domains:forms.routeForm.typeProxy") },
                  { value: "static", label: t("domains:forms.routeForm.typeStatic") },
                  { value: "redirect", label: t("domains:forms.routeForm.typeRedirect") },
                ]}
                value={field.value}
                onChange={(value) => field.onChange(value)}
              />
            </Field>
          )}
        />
        <Field data-invalid={Boolean(form.formState.errors.path)}>
          <FieldLabel htmlFor="routePath">{t("domains:forms.routeForm.path")}</FieldLabel>
          <Input id="routePath" aria-invalid={Boolean(form.formState.errors.path)} {...form.register("path")} />
          <FieldDescription>{t("domains:forms.routeForm.pathDesc")}</FieldDescription>
          <FieldError errors={[form.formState.errors.path]} />
        </Field>
        {routeType === "proxy" || routeType === "redirect" ? (
          <Field data-invalid={Boolean(form.formState.errors.target)}>
            <FieldLabel htmlFor="routeTarget">{t("domains:forms.routeForm.targetUrl")}</FieldLabel>
            <Input id="routeTarget" aria-invalid={Boolean(form.formState.errors.target)} {...form.register("target")} />
            <FieldError errors={[form.formState.errors.target]} />
          </Field>
        ) : null}
        {routeType === "static" ? (
          <>
            <Field data-invalid={Boolean(form.formState.errors.root)}>
              <FieldLabel htmlFor="routeRoot">{t("domains:forms.routeForm.staticRoot")}</FieldLabel>
              <Input id="routeRoot" aria-invalid={Boolean(form.formState.errors.root)} {...form.register("root")} />
              <FieldError errors={[form.formState.errors.root]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="routeIndex">{t("domains:forms.routeForm.indexFile")}</FieldLabel>
              <Input id="routeIndex" {...form.register("index")} />
            </Field>
          </>
        ) : null}
        {routeType === "proxy" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {(["connectTimeoutSeconds", "readTimeoutSeconds", "sendTimeoutSeconds"] as const).map((name) => (
                <Field key={name} data-invalid={Boolean(form.formState.errors[name])}>
                  <FieldLabel htmlFor={name}>{name.replace("TimeoutSeconds", " timeout")}</FieldLabel>
                  <Input id={name} type="number" min={1} max={3600} aria-invalid={Boolean(form.formState.errors[name])} {...form.register(name, { valueAsNumber: true })} />
                  <FieldError errors={[form.formState.errors[name]]} />
                </Field>
              ))}
            </div>
            <Controller control={form.control} name="websocket" render={({ field }) => (
              <Field orientation="horizontal"><FieldContent><FieldTitle>{t("domains:forms.routeForm.websocket")}</FieldTitle><FieldDescription>{t("domains:forms.routeForm.websocketDesc")}</FieldDescription></FieldContent><Switch checked={field.value} onCheckedChange={field.onChange} /></Field>
            )} />
            <Controller control={form.control} name="preserveHost" render={({ field }) => (
              <Field orientation="horizontal"><FieldContent><FieldTitle>{t("domains:forms.routeForm.preserveHost")}</FieldTitle><FieldDescription>{t("domains:forms.routeForm.preserveHostDesc")}</FieldDescription></FieldContent><Switch checked={field.value} onCheckedChange={field.onChange} /></Field>
            )} />
          </>
        ) : null}
        {routeType === "static" ? (
          <Controller control={form.control} name="spaFallback" render={({ field }) => (
            <Field orientation="horizontal"><FieldContent><FieldTitle>{t("domains:forms.routeForm.spaFallback")}</FieldTitle><FieldDescription>{t("domains:forms.routeForm.spaFallbackDesc")}</FieldDescription></FieldContent><Switch checked={field.value} onCheckedChange={field.onChange} /></Field>
          )} />
        ) : null}
        <Controller control={form.control} name="enabled" render={({ field }) => (
          <Field orientation="horizontal"><FieldContent><FieldTitle>{t("domains:forms.routeForm.enabled")}</FieldTitle><FieldDescription>{t("domains:forms.routeForm.enabledDesc")}</FieldDescription></FieldContent><Switch checked={field.value} onCheckedChange={field.onChange} /></Field>
        )} />
      </FieldGroup>

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t("domains:forms.routeForm.previewTitle")}</p>
        <pre className="overflow-x-auto font-mono text-xs">{`location ${path || "/"} {\n  ${routeType === "static" ? "root ...;" : routeType === "redirect" ? `return ... ${target};` : `proxy_pass ${target};`}\n}`}</pre>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>{t("domains:common.actions.cancel")}</Button>
        <Button type="submit" disabled={submitting}>{submitting ? t("domains:common.actions.saving") : t("domains:forms.routeForm.saveToDraft")}</Button>
      </DialogFooter>
    </form>
  );
}
