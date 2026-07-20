import * as React from "react";
import { useRouter } from "next/router";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { hostnameSchema, type DomainConfig, type RouteConfig } from "@/shared/schemas";
import { ApiError, createDomain } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n-utils";

const formSchema = z
  .object({
    primaryHostname: hostnameSchema,
    aliases: z.string().max(4096),
    routeType: z.enum(["none", "proxy", "static", "redirect"]),
    routePath: z.string().startsWith("/", "路径必须以 / 开头"),
    target: z.string(),
    staticRoot: z.string(),
    staticIndex: z.string(),
    websocket: z.boolean(),
    preserveHost: z.boolean(),
    httpsEnabled: z.boolean(),
    email: z.string(),
    environment: z.enum(["staging", "production"]),
    autoRenew: z.boolean(),
    forceHttps: z.boolean(),
    validationMethod: z.enum(["http-01", "dns-manual"]),
  })
  .superRefine((value, ctx) => {
    if (["proxy", "redirect"].includes(value.routeType)) {
      const parsed = z.url().safeParse(value.target);
      if (!parsed.success || !/^https?:\/\//i.test(value.target)) {
        ctx.addIssue({ code: "custom", path: ["target"], message: "请输入完整的 HTTP 或 HTTPS URL" });
      }
    }
    if (value.routeType === "static" && !value.staticRoot.startsWith("/")) {
      ctx.addIssue({ code: "custom", path: ["staticRoot"], message: "静态目录必须是绝对路径" });
    }
    if (value.httpsEnabled && !z.email().safeParse(value.email).success) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "启用 HTTPS 时需要有效邮箱" });
    }
  });

type DomainFormValues = z.infer<typeof formSchema>;

const steps = ["域名", "初始类型", "HTTPS 与确认"];

function parseAliases(value: string) {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean))];
}

function buildRoute(values: DomainFormValues): RouteConfig[] {
  if (values.routeType === "none") return [];
  const base = {
    id: crypto.randomUUID(),
    path: values.routePath,
    enabled: true,
    order: 0,
  };
  if (values.routeType === "proxy") {
    return [
      {
        ...base,
        type: "proxy",
        target: values.target,
        websocket: values.websocket,
        preserveHost: values.preserveHost,
        connectTimeoutSeconds: 60,
        readTimeoutSeconds: 60,
        sendTimeoutSeconds: 60,
      },
    ];
  }
  if (values.routeType === "static") {
    return [
      {
        ...base,
        type: "static",
        root: values.staticRoot,
        index: values.staticIndex || "index.html",
        spaFallback: false,
      },
    ];
  }
  return [{ ...base, type: "redirect", target: values.target, statusCode: 301 }];
}

export function DomainForm() {
  const router = useRouter();
  const locale = useLocale();
  const [step, setStep] = React.useState(0);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const form = useForm<DomainFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      primaryHostname: "",
      aliases: "",
      routeType: "proxy",
      routePath: "/",
      target: "http://app:3000",
      staticRoot: "/srv/sites/",
      staticIndex: "index.html",
      websocket: false,
      preserveHost: true,
      httpsEnabled: false,
      email: "",
      environment: "production",
      autoRenew: true,
      forceHttps: true,
      validationMethod: "http-01",
    },
  });
  const routeType = useWatch({ control: form.control, name: "routeType" });
  const httpsEnabled = useWatch({ control: form.control, name: "httpsEnabled" });

  const nextStep = async () => {
    const fields: Array<keyof DomainFormValues> =
      step === 0
        ? ["primaryHostname", "aliases"]
        : ["routeType", "routePath", "target", "staticRoot", "staticIndex"];
    if (await form.trigger(fields)) setStep((current) => Math.min(current + 1, 2));
  };

  const submitDraft = form.handleSubmit(async (values) => {
    setServerError(null);
    const aliases = parseAliases(values.aliases);
    const config: DomainConfig = {
      schemaVersion: 1,
      primaryHostname: values.primaryHostname,
      aliases,
      routes: buildRoute(values),
      headers: [],
      ssl: {
        enabled: values.httpsEnabled,
        provider: "letsencrypt",
        environment: values.environment,
        email: values.email,
        autoRenew: values.autoRenew,
        forceHttps: values.forceHttps,
        validation:
          values.validationMethod === "http-01"
            ? { method: "http-01" }
            : { method: "dns-01", provider: "manual" },
      },
      advanced: { serverSnippet: "" },
    };

    try {
      const result = await createDomain({ config });
      await router.push(localizePath(`/domains/overview?id=${result.domainId}&created=1`, locale));
    } catch (error) {
      if (error instanceof ApiError) {
        setServerError(error.message);
        const primaryError = error.fieldErrors?.["config.primaryHostname"]?.[0];
        if (primaryError) {
          form.setError("primaryHostname", { message: primaryError });
          setStep(0);
        }
      } else {
        setServerError(error instanceof Error ? error.message : "创建失败");
      }
    }
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (step < 2) {
      event.preventDefault();
      void nextStep();
      return;
    }
    void submitDraft(event);
  };

  return (
    <form className="flex flex-col gap-8" onSubmit={handleSubmit}>
      <ol className="grid grid-cols-3 gap-2" aria-label="创建步骤">
        {steps.map((label, index) => (
          <li
            className={cn(
              "flex items-center gap-2 border-b-2 pb-3 text-sm",
              index <= step ? "border-primary text-foreground" : "border-border text-muted-foreground",
            )}
            key={label}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-current font-mono text-xs">
              {index < step ? <CheckIcon className="size-3" /> : index + 1}
            </span>
            <span className="hidden truncate sm:block">{label}</span>
          </li>
        ))}
      </ol>

      {serverError ? (
        <Alert variant="destructive">
          <AlertTitle>无法创建域名</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      {step === 0 ? (
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.primaryHostname)}>
            <FieldLabel htmlFor="primaryHostname">Primary Domain</FieldLabel>
            <Input
              id="primaryHostname"
              placeholder="example.com"
              autoComplete="off"
              aria-invalid={Boolean(form.formState.errors.primaryHostname)}
              {...form.register("primaryHostname")}
            />
            <FieldDescription>只接受标准 ASCII 或 Punycode 域名，不包含协议、端口和路径。</FieldDescription>
            <FieldError errors={[form.formState.errors.primaryHostname]} />
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.aliases)}>
            <FieldLabel htmlFor="aliases">Aliases</FieldLabel>
            <Input
              id="aliases"
              placeholder="www.example.com, api.example.com"
              autoComplete="off"
              aria-invalid={Boolean(form.formState.errors.aliases)}
              {...form.register("aliases")}
            />
            <FieldDescription>使用逗号分隔多个别名，系统会自动去重。</FieldDescription>
            <FieldError errors={[form.formState.errors.aliases]} />
          </Field>
        </FieldGroup>
      ) : null}

      {step === 1 ? (
        <FieldGroup>
          <Field>
            <FieldLabel>初始类型</FieldLabel>
            <Controller
              control={form.control}
              name="routeType"
              render={({ field }) => (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  className="grid w-full grid-cols-2 sm:grid-cols-4"
                  value={field.value}
                  onValueChange={(value) => value && field.onChange(value)}
                >
                  <ToggleGroupItem value="proxy">Reverse Proxy</ToggleGroupItem>
                  <ToggleGroupItem value="static">Static Website</ToggleGroupItem>
                  <ToggleGroupItem value="redirect">Redirect</ToggleGroupItem>
                  <ToggleGroupItem value="none">暂不添加</ToggleGroupItem>
                </ToggleGroup>
              )}
            />
          </Field>
          {routeType !== "none" ? (
            <Field data-invalid={Boolean(form.formState.errors.routePath)}>
              <FieldLabel htmlFor="routePath">Path</FieldLabel>
              <Input id="routePath" aria-invalid={Boolean(form.formState.errors.routePath)} {...form.register("routePath")} />
              <FieldError errors={[form.formState.errors.routePath]} />
            </Field>
          ) : null}
          {routeType === "proxy" || routeType === "redirect" ? (
            <Field data-invalid={Boolean(form.formState.errors.target)}>
              <FieldLabel htmlFor="target">Target URL</FieldLabel>
              <Input id="target" aria-invalid={Boolean(form.formState.errors.target)} {...form.register("target")} />
              <FieldError errors={[form.formState.errors.target]} />
            </Field>
          ) : null}
          {routeType === "static" ? (
            <>
              <Field data-invalid={Boolean(form.formState.errors.staticRoot)}>
                <FieldLabel htmlFor="staticRoot">Static Root</FieldLabel>
                <Input id="staticRoot" aria-invalid={Boolean(form.formState.errors.staticRoot)} {...form.register("staticRoot")} />
                <FieldError errors={[form.formState.errors.staticRoot]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="staticIndex">Index file</FieldLabel>
                <Input id="staticIndex" {...form.register("staticIndex")} />
              </Field>
            </>
          ) : null}
          {routeType === "proxy" ? (
            <>
              <Controller
                control={form.control}
                name="websocket"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle>WebSocket</FieldTitle>
                      <FieldDescription>注入受控的 Upgrade 和 Connection headers。</FieldDescription>
                    </FieldContent>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="preserveHost"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle>Preserve Host</FieldTitle>
                      <FieldDescription>向 upstream 传递原始请求 Host。</FieldDescription>
                    </FieldContent>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </Field>
                )}
              />
            </>
          ) : null}
        </FieldGroup>
      ) : null}

      {step === 2 ? (
        <FieldGroup>
          <Controller
            control={form.control}
            name="httpsEnabled"
            render={({ field }) => (
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Enable HTTPS</FieldTitle>
                  <FieldDescription>这里只保存申请意图，创建草稿不会申请证书。</FieldDescription>
                </FieldContent>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </Field>
            )}
          />
          {httpsEnabled ? (
            <>
              <Field data-invalid={Boolean(form.formState.errors.email)}>
                <FieldLabel htmlFor="email">Let&apos;s Encrypt 邮箱</FieldLabel>
                <Input id="email" type="email" aria-invalid={Boolean(form.formState.errors.email)} {...form.register("email")} />
                <FieldError errors={[form.formState.errors.email]} />
              </Field>
              <Field>
                <FieldLabel>Environment</FieldLabel>
                <Controller
                  control={form.control}
                  name="environment"
                  render={({ field }) => (
                    <ToggleGroup type="single" variant="outline" value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                      <ToggleGroupItem value="production">Production</ToggleGroupItem>
                      <ToggleGroupItem value="staging">Staging</ToggleGroupItem>
                    </ToggleGroup>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel>Validation Method</FieldLabel>
                <Controller
                  control={form.control}
                  name="validationMethod"
                  render={({ field }) => (
                    <ToggleGroup type="single" variant="outline" value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                      <ToggleGroupItem value="http-01">HTTP-01</ToggleGroupItem>
                      <ToggleGroupItem value="dns-manual">DNS-01 Manual</ToggleGroupItem>
                    </ToggleGroup>
                  )}
                />
              </Field>
              <Controller
                control={form.control}
                name="autoRenew"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldContent><FieldTitle>Auto renew</FieldTitle><FieldDescription>证书模块完成后按此策略续期。</FieldDescription></FieldContent>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="forceHttps"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldContent><FieldTitle>Force HTTPS</FieldTitle><FieldDescription>发布后使用 308 保留请求 method 和 body。</FieldDescription></FieldContent>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </Field>
                )}
              />
            </>
          ) : null}
          <Alert>
            <AlertTitle>即将创建 v1 草稿</AlertTitle>
            <AlertDescription>
              {form.getValues("primaryHostname")}，{buildRoute(form.getValues()).length} 条初始路由，HTTPS {httpsEnabled ? "已选择" : "未启用"}。线上 Nginx 不会改变。
            </AlertDescription>
          </Alert>
        </FieldGroup>
      ) : null}

      <div className="flex items-center justify-between border-t border-border pt-5">
        <Button
          type="button"
          variant="ghost"
          onClick={() => (step === 0 ? void router.push(localizePath("/domains", locale)) : setStep((current) => current - 1))}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          {step === 0 ? "取消" : "上一步"}
        </Button>
        {step < 2 ? (
          <Button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              void nextStep();
            }}
          >
            下一步
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        ) : (
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : null}
            创建草稿
          </Button>
        )}
      </div>
    </form>
  );
}
