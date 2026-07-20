import * as React from "react";
import { useRouter } from "next/router";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { localizedZodResolver } from "@/lib/i18n-form";
import { Clock3Icon, EyeIcon, EyeOffIcon, KeyRoundIcon, LoaderCircleIcon, LogOutIcon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { changePassword, getSessionPolicy, logout, revokeAllSessions, updateSessionPolicy } from "@/lib/api";
import { useLocale } from "@/hooks/use-locale";
import { formatErrorMessage } from "@/lib/i18n-error";
import { localizePath } from "@/lib/i18n-utils";
import { changePasswordSchema, sessionPolicySchema, type ChangePasswordInput, type SessionPolicy } from "@/shared/schemas";

export function SecuritySettingsForm() {
  const { t } = useTranslation(["common"]);
  const router = useRouter();
  const locale = useLocale();
  const [showPasswords, setShowPasswords] = React.useState(false);
  const [serverError, setServerError] = React.useState<string>();
  const [policyError, setPolicyError] = React.useState<string>();
  const [revoking, setRevoking] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const policyQuery = useApiQuery(getSessionPolicy);
  const form = useForm<ChangePasswordInput>({
    resolver: localizedZodResolver(changePasswordSchema, t),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const policyForm = useForm<SessionPolicy>({
    resolver: localizedZodResolver(sessionPolicySchema, t),
    defaultValues: { standardDays: 1, rememberDays: 30 },
  });

  React.useEffect(() => {
    if (policyQuery.data) policyForm.reset(policyQuery.data.policy);
  }, [policyForm, policyQuery.data]);

  const submit = form.handleSubmit(async (input) => {
    setServerError(undefined);
    try {
      await changePassword(input);
      form.reset();
      toast.success(t("common:settings.security.passwordChanged"));
    } catch (error) {
      setServerError(formatErrorMessage(t, error, "errors:passwordChangeFailed"));
    }
  });

  const revoke = async () => {
    setRevoking(true);
    setServerError(undefined);
    try {
      await revokeAllSessions();
      await router.replace(localizePath("/login", locale));
    } catch (error) {
      setServerError(formatErrorMessage(t, error, "errors:sessionRevokeFailed"));
      setRevoking(false);
    }
  };

  const signOut = async () => {
    setLoggingOut(true);
    setServerError(undefined);
    try {
      await logout();
      await router.replace(localizePath("/login", locale));
    } catch (error) {
      setServerError(formatErrorMessage(t, error, "errors:logoutFailed"));
      setLoggingOut(false);
    }
  };

  const savePolicy = policyForm.handleSubmit(async (policy) => {
    setPolicyError(undefined);
    try {
      const result = await updateSessionPolicy(policy);
      policyForm.reset(result.policy);
      toast.success(t("common:settings.security.sessionPolicySaved"));
    } catch (error) {
      setPolicyError(formatErrorMessage(t, error, "errors:sessionPolicySaveFailed"));
    }
  });

  const passwordField = (
    name: keyof ChangePasswordInput,
    label: string,
    autoComplete: "current-password" | "new-password",
  ) => (
    <Field data-invalid={Boolean(form.formState.errors[name])}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={name}
          type={showPasswords ? "text" : "password"}
          autoComplete={autoComplete}
          aria-invalid={Boolean(form.formState.errors[name])}
          {...form.register(name)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="button"
            size="icon-xs"
            aria-label={showPasswords ? t("common:settings.security.hidePassword") : t("common:settings.security.showPassword")}
            onClick={() => setShowPasswords((value) => !value)}
          >
            {showPasswords ? <EyeOffIcon /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {name === "newPassword" ? <FieldDescription>{t("common:settings.security.changePassword.newPasswordDescription")}</FieldDescription> : null}
      <FieldError errors={[form.formState.errors[name]]} />
    </Field>
  );

  return (
    <div className="flex flex-col gap-6">
      {serverError ? <Alert variant="destructive"><AlertTitle>{t("common:settings.security.operationFailed")}</AlertTitle><AlertDescription>{serverError}</AlertDescription></Alert> : null}

      <form onSubmit={submit}>
        <Card className="border border-border">
          <CardHeader>
            <CardTitle>{t("common:settings.security.changePassword.title")}</CardTitle>
            <CardDescription>{t("common:settings.security.changePassword.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {passwordField("currentPassword", t("common:settings.security.changePassword.currentPassword"), "current-password")}
              {passwordField("newPassword", t("common:settings.security.changePassword.newPassword"), "new-password")}
              {passwordField("confirmPassword", t("common:settings.security.changePassword.confirmPassword"), "new-password")}
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : <KeyRoundIcon data-icon="inline-start" />}
              {t("common:settings.security.changePassword.submit")}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <form onSubmit={savePolicy}>
        <Card className="border border-border">
          <CardHeader>
            <CardTitle>{t("common:settings.security.sessionPolicy.title")}</CardTitle>
            <CardDescription>{t("common:settings.security.sessionPolicy.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {policyQuery.loading && !policyQuery.data ? <Skeleton className="h-36" /> : (
              <FieldGroup className="grid gap-5 md:grid-cols-2">
                <Field data-invalid={Boolean(policyForm.formState.errors.standardDays)}>
                  <FieldLabel htmlFor="standardDays">{t("common:settings.security.sessionPolicy.standardDays")}</FieldLabel>
                  <InputGroup>
                    <InputGroupInput id="standardDays" type="number" min={1} max={7} inputMode="numeric" aria-invalid={Boolean(policyForm.formState.errors.standardDays)} {...policyForm.register("standardDays", { valueAsNumber: true })} />
                    <InputGroupAddon align="inline-end">{t("common:settings.security.sessionPolicy.standardDaysAddon")}</InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>{t("common:settings.security.sessionPolicy.standardDaysDescription")}</FieldDescription>
                  <FieldError errors={[policyForm.formState.errors.standardDays]} />
                </Field>
                <Field data-invalid={Boolean(policyForm.formState.errors.rememberDays)}>
                  <FieldLabel htmlFor="rememberDays">{t("common:settings.security.sessionPolicy.rememberDays")}</FieldLabel>
                  <InputGroup>
                    <InputGroupInput id="rememberDays" type="number" min={7} max={90} inputMode="numeric" aria-invalid={Boolean(policyForm.formState.errors.rememberDays)} {...policyForm.register("rememberDays", { valueAsNumber: true })} />
                    <InputGroupAddon align="inline-end">{t("common:settings.security.sessionPolicy.rememberDaysAddon")}</InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>{t("common:settings.security.sessionPolicy.rememberDaysDescription")}</FieldDescription>
                  <FieldError errors={[policyForm.formState.errors.rememberDays]} />
                </Field>
              </FieldGroup>
            )}
            {policyError || policyQuery.error ? <Alert className="mt-5" variant="destructive"><AlertTitle>{t("errors:sessionPolicyOpFailed")}</AlertTitle><AlertDescription>{policyError ?? (policyQuery.error ? formatErrorMessage(t, policyQuery.error) : null)}</AlertDescription></Alert> : null}
            <p className="mt-5 text-xs text-muted-foreground">{t("common:settings.security.sessionPolicy.note")}</p>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={!policyQuery.data || policyForm.formState.isSubmitting || !policyForm.formState.isDirty}>
              {policyForm.formState.isSubmitting ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : <Clock3Icon data-icon="inline-start" />}
              {t("common:settings.security.sessionPolicy.submit")}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>{t("common:settings.security.logout.title")}</CardTitle>
          <CardDescription>{t("common:settings.security.logout.description")}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="outline"><LogOutIcon data-icon="inline-start" />{t("common:settings.security.logout.button")}</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("common:settings.security.logout.confirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("common:settings.security.logout.confirmDescription")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={loggingOut}>{t("common:settings.security.cancel")}</AlertDialogCancel>
                <AlertDialogAction disabled={loggingOut} onClick={(event) => { event.preventDefault(); void signOut(); }}>
                  {loggingOut ? <LoaderCircleIcon className="animate-spin" /> : null}{t("common:settings.security.logout.confirmAction")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>
      <Card className="border border-destructive/30">
        <CardHeader>
          <CardTitle>{t("common:settings.security.revokeAll.title")}</CardTitle>
          <CardDescription>{t("common:settings.security.revokeAll.description")}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive"><LogOutIcon data-icon="inline-start" />{t("common:settings.security.revokeAll.button")}</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("common:settings.security.revokeAll.confirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("common:settings.security.revokeAll.confirmDescription")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={revoking}>{t("common:settings.security.cancel")}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" disabled={revoking} onClick={(event) => { event.preventDefault(); void revoke(); }}>
                  {revoking ? <LoaderCircleIcon className="animate-spin" /> : null}{t("common:settings.security.revokeAll.confirmAction")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>
    </div>
  );
}
