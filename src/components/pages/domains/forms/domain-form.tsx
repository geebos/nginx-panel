import * as React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useRouter } from "next/router";
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
import { formatErrorMessage, formatMessageKey } from "@/lib/i18n/error";
import { localizePath } from "@/lib/i18n/utils";
import { localizedZodResolver } from "@/lib/i18n/form";

function buildFormSchema(t: TFunction) {
  return z
    .object({
      primaryHostname: hostnameSchema,
      aliases: z.string().max(4096),
      routeType: z.enum(["none", "proxy", "static", "redirect"]),
      routePath: z.string().startsWith("/", t("domains:forms.domainForm.validations.pathStart")),
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
          ctx.addIssue({ code: "custom", path: ["target"], message: t("domains:forms.domainForm.validations.targetUrl") });
        }
      }
      if (value.routeType === "static" && !value.staticRoot.startsWith("/")) {
        ctx.addIssue({ code: "custom", path: ["staticRoot"], message: t("domains:forms.domainForm.validations.staticRoot") });
      }
      if (value.httpsEnabled && !z.email().safeParse(value.email).success) {
        ctx.addIssue({ code: "custom", path: ["email"], message: t("domains:forms.domainForm.validations.emailRequired") });
      }
    });
}

type DomainFormValues = z.infer<ReturnType<typeof buildFormSchema>>;

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
  const { t } = useTranslation(["common", "domains"]);
  const router = useRouter();
  const locale = useLocale();
  const [step, setStep] = React.useState(0);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const formSchema = React.useMemo(() => buildFormSchema(t), [t]);
  const form = useForm<DomainFormValues>({
    resolver: localizedZodResolver(formSchema, t),
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

  const steps = [
    t("domains:forms.domainForm.steps.domain"),
    t("domains:forms.domainForm.steps.routeType"),
    t("domains:forms.domainForm.steps.https"),
  ];

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
        setServerError(formatErrorMessage(t, error));
        const primaryError = error.fieldErrors?.["config.primaryHostname"]?.[0];
        if (primaryError) {
          form.setError("primaryHostname", {
            message: formatMessageKey(t, primaryError, error.params),
          });
          setStep(0);
        }
      } else {
        setServerError(formatErrorMessage(t, error, "domains:forms.domainForm.createFailed"));
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
      <ol className="grid grid-cols-3 gap-2" aria-label={t("domains:forms.domainForm.stepsAria")}>
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
          <AlertTitle>{t("domains:forms.domainForm.alertTitle")}</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      {step === 0 ? (
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.primaryHostname)}>
            <FieldLabel htmlFor="primaryHostname">{t("domains:forms.domainForm.primaryDomain")}</FieldLabel>
            <Input
              id="primaryHostname"
              placeholder="example.com"
              autoComplete="off"
              aria-invalid={Boolean(form.formState.errors.primaryHostname)}
              {...form.register("primaryHostname")}
            />
            <FieldDescription>{t("domains:forms.domainForm.primaryDomainDesc")}</FieldDescription>
            <FieldError errors={[form.formState.errors.primaryHostname]} />
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.aliases)}>
            <FieldLabel htmlFor="aliases">{t("domains:forms.domainForm.aliases")}</FieldLabel>
            <Input
              id="aliases"
              placeholder="www.example.com, api.example.com"
              autoComplete="off"
              aria-invalid={Boolean(form.formState.errors.aliases)}
              {...form.register("aliases")}
            />
            <FieldDescription>{t("domains:forms.domainForm.aliasesDesc")}</FieldDescription>
            <FieldError errors={[form.formState.errors.aliases]} />
          </Field>
        </FieldGroup>
      ) : null}

      {step === 1 ? (
        <FieldGroup>
          <Field>
            <FieldLabel>{t("domains:forms.domainForm.routeType")}</FieldLabel>
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
                  <ToggleGroupItem value="proxy">{t("domains:forms.domainForm.routeTypeProxy")}</ToggleGroupItem>
                  <ToggleGroupItem value="static">{t("domains:forms.domainForm.routeTypeStatic")}</ToggleGroupItem>
                  <ToggleGroupItem value="redirect">{t("domains:forms.domainForm.routeTypeRedirect")}</ToggleGroupItem>
                  <ToggleGroupItem value="none">{t("domains:forms.domainForm.routeTypeNone")}</ToggleGroupItem>
                </ToggleGroup>
              )}
            />
          </Field>
          {routeType !== "none" ? (
            <Field data-invalid={Boolean(form.formState.errors.routePath)}>
              <FieldLabel htmlFor="routePath">{t("domains:forms.domainForm.path")}</FieldLabel>
              <Input id="routePath" aria-invalid={Boolean(form.formState.errors.routePath)} {...form.register("routePath")} />
              <FieldError errors={[form.formState.errors.routePath]} />
            </Field>
          ) : null}
          {routeType === "proxy" || routeType === "redirect" ? (
            <Field data-invalid={Boolean(form.formState.errors.target)}>
              <FieldLabel htmlFor="target">{t("domains:forms.domainForm.targetUrl")}</FieldLabel>
              <Input id="target" aria-invalid={Boolean(form.formState.errors.target)} {...form.register("target")} />
              <FieldError errors={[form.formState.errors.target]} />
            </Field>
          ) : null}
          {routeType === "static" ? (
            <>
              <Field data-invalid={Boolean(form.formState.errors.staticRoot)}>
                <FieldLabel htmlFor="staticRoot">{t("domains:forms.domainForm.staticRoot")}</FieldLabel>
                <Input id="staticRoot" aria-invalid={Boolean(form.formState.errors.staticRoot)} {...form.register("staticRoot")} />
                <FieldError errors={[form.formState.errors.staticRoot]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="staticIndex">{t("domains:forms.domainForm.indexFile")}</FieldLabel>
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
                      <FieldTitle>{t("domains:forms.domainForm.websocket")}</FieldTitle>
                      <FieldDescription>{t("domains:forms.domainForm.websocketDesc")}</FieldDescription>
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
                      <FieldTitle>{t("domains:forms.domainForm.preserveHost")}</FieldTitle>
                      <FieldDescription>{t("domains:forms.domainForm.preserveHostDesc")}</FieldDescription>
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
                  <FieldTitle>{t("domains:forms.domainForm.enableHttps")}</FieldTitle>
                  <FieldDescription>{t("domains:forms.domainForm.enableHttpsDesc")}</FieldDescription>
                </FieldContent>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </Field>
            )}
          />
          {httpsEnabled ? (
            <>
              <Field data-invalid={Boolean(form.formState.errors.email)}>
                <FieldLabel htmlFor="email">{t("domains:forms.domainForm.email")}</FieldLabel>
                <Input id="email" type="email" aria-invalid={Boolean(form.formState.errors.email)} {...form.register("email")} />
                <FieldError errors={[form.formState.errors.email]} />
              </Field>
              <Field>
                <FieldLabel>{t("domains:forms.domainForm.environment")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="environment"
                  render={({ field }) => (
                    <ToggleGroup type="single" variant="outline" value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                      <ToggleGroupItem value="production">{t("domains:forms.domainForm.environmentProduction")}</ToggleGroupItem>
                      <ToggleGroupItem value="staging">{t("domains:forms.domainForm.environmentStaging")}</ToggleGroupItem>
                    </ToggleGroup>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel>{t("domains:forms.domainForm.validationMethod")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="validationMethod"
                  render={({ field }) => (
                    <ToggleGroup type="single" variant="outline" value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                      <ToggleGroupItem value="http-01">{t("domains:forms.domainForm.validationHttp01")}</ToggleGroupItem>
                      <ToggleGroupItem value="dns-manual">{t("domains:forms.domainForm.validationDnsManual")}</ToggleGroupItem>
                    </ToggleGroup>
                  )}
                />
              </Field>
              <Controller
                control={form.control}
                name="autoRenew"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldContent><FieldTitle>{t("domains:forms.domainForm.autoRenew")}</FieldTitle><FieldDescription>{t("domains:forms.domainForm.autoRenewDesc")}</FieldDescription></FieldContent>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="forceHttps"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldContent><FieldTitle>{t("domains:forms.domainForm.forceHttps")}</FieldTitle><FieldDescription>{t("domains:forms.domainForm.forceHttpsDesc")}</FieldDescription></FieldContent>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </Field>
                )}
              />
            </>
          ) : null}
          <Alert>
            <AlertTitle>{t("domains:forms.domainForm.v1AlertTitle")}</AlertTitle>
            <AlertDescription>
              {t("domains:forms.domainForm.v1AlertDescription", {
                hostname: form.getValues("primaryHostname"),
                count: buildRoute(form.getValues()).length,
                https: httpsEnabled ? t("domains:forms.domainForm.httpsSelected") : t("domains:forms.domainForm.httpsNotEnabled"),
              })}
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
          {step === 0 ? t("domains:forms.domainForm.cancel") : t("domains:common.actions.previousStep")}
        </Button>
        {step < 2 ? (
          <Button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              void nextStep();
            }}
          >
            {t("domains:forms.domainForm.next")}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        ) : (
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : null}
            {t("domains:forms.domainForm.createDraft")}
          </Button>
        )}
      </div>
    </form>
  );
}
