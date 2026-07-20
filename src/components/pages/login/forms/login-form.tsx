import * as React from "react";
import { useRouter } from "@/hooks/use-router";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { localizedZodResolver } from "@/lib/i18n/form";
import { z } from "zod";
import { EyeIcon, EyeOffIcon, LoaderCircleIcon, LockKeyholeIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser, getSetupStatus, login, setupAdmin } from "@/lib/api";
import { formatErrorMessage, formatMessageKey, zodIssueParams } from "@/lib/i18n/error";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { passwordSchema, usernameSchema } from "@/shared/schemas";
import { useApiQuery } from "@/hooks/use-api-query";

export function LoginForm() {
  const { t } = useTranslation(["common", "login"]);
  const router = useRouter();
  const setupQuery = useApiQuery(getSetupStatus);
  const [showPassword, setShowPassword] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const setupRequired = setupQuery.data?.setupRequired ?? false;
  const formSchema = React.useMemo(
    () =>
      z.object({
        username: usernameSchema,
        password: z.string().min(1, t("login:errors.passwordRequired")).max(128),
        confirmPassword: z.string().max(128),
        remember: z.boolean(),
        managerPrimaryHostname: z.string().max(253),
      }),
    [t],
  );
  type LoginFormValues = z.infer<typeof formSchema>;
  const form = useForm<LoginFormValues>({
    resolver: localizedZodResolver(formSchema, t),
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
      remember: false,
      managerPrimaryHostname: "",
    },
  });

  React.useEffect(() => {
    if (!router.isReady) return;
    void getCurrentUser()
      .then(() => router.replace("/dashboard"))
      .catch(() => undefined);
  }, [router]);

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    if (setupRequired) {
      const passwordResult = passwordSchema.safeParse(values.password);
      if (!passwordResult.success) {
        const issue = passwordResult.error.issues[0];
        form.setError("password", { message: formatMessageKey(t, issue?.message, zodIssueParams(issue)) });
        return;
      }
      if (values.password !== values.confirmPassword) {
        form.setError("confirmPassword", { message: t("login:errors.passwordMismatch") });
        return;
      }
    }

    try {
      if (setupRequired) {
        const managerPrimaryHostname = values.managerPrimaryHostname.trim() || undefined;
        await setupAdmin({
          username: values.username,
          password: values.password,
          managerPrimaryHostname,
        });
      } else {
        await login({ username: values.username, password: values.password, remember: values.remember });
      }
      await router.replace(safeRedirectPath(router.query.redirect));
    } catch (error) {
      setServerError(formatErrorMessage(t, error, "login:loginFailed"));
    }
  });

  if (setupQuery.loading && !setupQuery.data) {
    return <Skeleton className="h-80 w-full" />;
  }

  if (setupQuery.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("login:apiConnectFailed")}</AlertTitle>
        <AlertDescription>{formatErrorMessage(t, setupQuery.error)}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <div className="flex flex-col gap-2">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LockKeyholeIcon className="size-5" />
        </div>
        <div>
          <h1 className="font-heading text-[26px] font-normal tracking-[-0.02em]">
            {setupRequired ? t("login:title.setup") : t("login:title.login")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {setupRequired
              ? t("login:description.setup")
              : t("login:description.login")}
          </p>
        </div>
      </div>

      {serverError ? (
        <Alert variant="destructive">
          <AlertTitle>{setupRequired ? t("login:setupFailed") : t("login:loginFailed")}</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field data-invalid={Boolean(form.formState.errors.username)}>
          <FieldLabel htmlFor="username">{t("login:username")}</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="username"
              autoComplete="username"
              aria-invalid={Boolean(form.formState.errors.username)}
              {...form.register("username")}
            />
          </InputGroup>
          <FieldDescription>{t("login:usernameDescription")}</FieldDescription>
          <FieldError errors={[form.formState.errors.username]} />
        </Field>

        <Field data-invalid={Boolean(form.formState.errors.password)}>
          <FieldLabel htmlFor="password">{t("login:password")}</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete={setupRequired ? "new-password" : "current-password"}
              aria-invalid={Boolean(form.formState.errors.password)}
              {...form.register("password")}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={showPassword ? t("login:hidePassword") : t("login:showPassword")}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {setupRequired ? <FieldDescription>{t("login:passwordMinLength")}</FieldDescription> : null}
          <FieldError errors={[form.formState.errors.password]} />
        </Field>

        {setupRequired ? (
          <>
            <Field data-invalid={Boolean(form.formState.errors.confirmPassword)}>
              <FieldLabel htmlFor="confirmPassword">{t("login:confirmPassword")}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  aria-invalid={Boolean(form.formState.errors.confirmPassword)}
                  {...form.register("confirmPassword")}
                />
              </InputGroup>
              <FieldError errors={[form.formState.errors.confirmPassword]} />
            </Field>
            <Field data-invalid={Boolean(form.formState.errors.managerPrimaryHostname)}>
              <FieldLabel htmlFor="managerPrimaryHostname">{t("login:managerHostname")}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="managerPrimaryHostname"
                  autoComplete="off"
                  placeholder="panel.example.com"
                  aria-invalid={Boolean(form.formState.errors.managerPrimaryHostname)}
                  {...form.register("managerPrimaryHostname")}
                />
              </InputGroup>
              <FieldDescription>{t("login:managerHostnameDescription")}</FieldDescription>
              <FieldError errors={[form.formState.errors.managerPrimaryHostname]} />
            </Field>
          </>
        ) : (
          <Controller
            control={form.control}
            name="remember"
            render={({ field }) => (
              <Field orientation="horizontal">
                <Checkbox
                  id="remember"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor="remember">{t("login:remember")}</FieldLabel>
                  <FieldDescription>{t("login:rememberDescription")}</FieldDescription>
                </FieldContent>
              </Field>
            )}
          />
        )}
      </FieldGroup>

      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : null}
        {setupRequired ? t("login:submit.setup") : t("login:submit.login")}
      </Button>
    </form>
  );
}
