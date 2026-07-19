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

const headerFormSchema = z.object({
  name: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "Header 名称格式无效"),
  value: z.string().max(4096).refine((value) => !/[\r\n\0]/.test(value), "Header 值不能包含换行或 NUL"),
  scope: z.string().min(1),
  always: z.boolean(),
  enabled: z.boolean(),
});

type HeaderFormValues = z.infer<typeof headerFormSchema>;

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
      form.setError("name", { message: "启用 HTTPS 后才能添加 HSTS" });
      return;
    }
    const routeId = values.scope.startsWith("route:") ? values.scope.slice(6) : null;
    await onSubmit({
      id: header?.id ?? crypto.randomUUID(),
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
          <FieldLabel htmlFor="headerName">Name</FieldLabel>
          <Input id="headerName" aria-invalid={Boolean(form.formState.errors.name)} placeholder="X-Content-Type-Options" {...form.register("name")} />
          <FieldError errors={[form.formState.errors.name]} />
        </Field>
        <Field data-invalid={Boolean(form.formState.errors.value)}>
          <FieldLabel htmlFor="headerValue">Value</FieldLabel>
          <Input id="headerValue" aria-invalid={Boolean(form.formState.errors.value)} placeholder="nosniff" {...form.register("value")} />
          <FieldDescription>禁止换行和 NUL；Nginx 生成器会安全引用该值。</FieldDescription>
          <FieldError errors={[form.formState.errors.value]} />
        </Field>
        <Controller control={form.control} name="scope" render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="headerScope">Scope</FieldLabel>
            <Select
              id="headerScope"
              options={[
                { value: "server", label: "Server" },
                ...routes.map((route) => ({ value: `route:${route.id}`, label: `Route ${route.path}` })),
              ]}
              value={field.value}
              onChange={field.onChange}
            />
            <FieldDescription>Server 应用于整个域名；Route 只写入指定 location。</FieldDescription>
          </Field>
        )} />
        <Controller control={form.control} name="always" render={({ field }) => (
          <Field orientation="horizontal"><FieldContent><FieldTitle>Always</FieldTitle><FieldDescription>在非成功响应中也添加该 Header。</FieldDescription></FieldContent><Switch checked={field.value} onCheckedChange={field.onChange} /></Field>
        )} />
        <Controller control={form.control} name="enabled" render={({ field }) => (
          <Field orientation="horizontal"><FieldContent><FieldTitle>Enabled</FieldTitle><FieldDescription>关闭后保留在快照中，但不生成 add_header。</FieldDescription></FieldContent><Switch checked={field.value} onCheckedChange={field.onChange} /></Field>
        )} />
      </FieldGroup>
      {name.toLowerCase() === "strict-transport-security" ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground">
          HSTS 会被浏览器长期缓存；使用 includeSubDomains 前请确认所有子域都支持 HTTPS。
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
        <Button type="submit" disabled={submitting}>{submitting ? "保存中" : "保存到草稿"}</Button>
      </DialogFooter>
    </form>
  );
}
