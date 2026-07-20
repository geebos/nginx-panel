import * as React from "react";
import { useRouter } from "next/router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
import { localizePath } from "@/lib/i18n-utils";
import { changePasswordSchema, sessionPolicySchema, type ChangePasswordInput, type SessionPolicy } from "@/shared/schemas";

export function SecuritySettingsForm() {
  const router = useRouter();
  const locale = useLocale();
  const [showPasswords, setShowPasswords] = React.useState(false);
  const [serverError, setServerError] = React.useState<string>();
  const [policyError, setPolicyError] = React.useState<string>();
  const [revoking, setRevoking] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const policyQuery = useApiQuery(getSessionPolicy);
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const policyForm = useForm<SessionPolicy>({
    resolver: zodResolver(sessionPolicySchema),
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
      toast.success("管理员密码已修改，其他会话已撤销");
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "密码修改失败");
    }
  });

  const revoke = async () => {
    setRevoking(true);
    setServerError(undefined);
    try {
      await revokeAllSessions();
      await router.replace(localizePath("/login", locale));
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "会话撤销失败");
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
      setServerError(error instanceof Error ? error.message : "退出登录失败");
      setLoggingOut(false);
    }
  };

  const savePolicy = policyForm.handleSubmit(async (policy) => {
    setPolicyError(undefined);
    try {
      const result = await updateSessionPolicy(policy);
      policyForm.reset(result.policy);
      toast.success("会话有效期策略已保存");
    } catch (error) {
      setPolicyError(error instanceof Error ? error.message : "会话策略保存失败");
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
            aria-label={showPasswords ? "隐藏密码" : "显示密码"}
            onClick={() => setShowPasswords((value) => !value)}
          >
            {showPasswords ? <EyeOffIcon /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {name === "newPassword" ? <FieldDescription>至少 12 个字符；修改成功后当前浏览器会话将安全轮换。</FieldDescription> : null}
      <FieldError errors={[form.formState.errors[name]]} />
    </Field>
  );

  return (
    <div className="flex flex-col gap-6">
      {serverError ? <Alert variant="destructive"><AlertTitle>安全设置操作失败</AlertTitle><AlertDescription>{serverError}</AlertDescription></Alert> : null}

      <form onSubmit={submit}>
        <Card className="border border-border">
          <CardHeader>
            <CardTitle>修改管理员密码</CardTitle>
            <CardDescription>必须验证当前密码。连续失败 3 次后，同一管理员与 Client IP 将暂停此操作 30 分钟。</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {passwordField("currentPassword", "当前密码", "current-password")}
              {passwordField("newPassword", "新密码", "new-password")}
              {passwordField("confirmPassword", "确认新密码", "new-password")}
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : <KeyRoundIcon data-icon="inline-start" />}
              修改密码
            </Button>
          </CardFooter>
        </Card>
      </form>

      <form onSubmit={savePolicy}>
        <Card className="border border-border">
          <CardHeader>
            <CardTitle>会话有效期</CardTitle>
            <CardDescription>分别控制普通登录与勾选“保持登录”后新签发 Session 的最长有效时间。</CardDescription>
          </CardHeader>
          <CardContent>
            {policyQuery.loading && !policyQuery.data ? <Skeleton className="h-36" /> : (
              <FieldGroup className="grid gap-5 md:grid-cols-2">
                <Field data-invalid={Boolean(policyForm.formState.errors.standardDays)}>
                  <FieldLabel htmlFor="standardDays">普通会话（天）</FieldLabel>
                  <InputGroup>
                    <InputGroupInput id="standardDays" type="number" min={1} max={7} inputMode="numeric" aria-invalid={Boolean(policyForm.formState.errors.standardDays)} {...policyForm.register("standardDays", { valueAsNumber: true })} />
                    <InputGroupAddon align="inline-end">1–7 天</InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>用户未勾选“保持登录”时使用。</FieldDescription>
                  <FieldError errors={[policyForm.formState.errors.standardDays]} />
                </Field>
                <Field data-invalid={Boolean(policyForm.formState.errors.rememberDays)}>
                  <FieldLabel htmlFor="rememberDays">保持登录（天）</FieldLabel>
                  <InputGroup>
                    <InputGroupInput id="rememberDays" type="number" min={7} max={90} inputMode="numeric" aria-invalid={Boolean(policyForm.formState.errors.rememberDays)} {...policyForm.register("rememberDays", { valueAsNumber: true })} />
                    <InputGroupAddon align="inline-end">7–90 天</InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>用户勾选“保持登录”时使用。</FieldDescription>
                  <FieldError errors={[policyForm.formState.errors.rememberDays]} />
                </Field>
              </FieldGroup>
            )}
            {policyError || policyQuery.error ? <Alert className="mt-5" variant="destructive"><AlertTitle>会话策略操作失败</AlertTitle><AlertDescription>{policyError ?? policyQuery.error?.message}</AlertDescription></Alert> : null}
            <p className="mt-5 text-xs text-muted-foreground">策略仅影响保存后新签发的 Session；现有 Session 的到期时间不会被延长或缩短。</p>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={!policyQuery.data || policyForm.formState.isSubmitting || !policyForm.formState.isDirty}>
              {policyForm.formState.isSubmitting ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : <Clock3Icon data-icon="inline-start" />}
              保存会话策略
            </Button>
          </CardFooter>
        </Card>
      </form>

      <Card className="border border-border">
        <CardHeader>
          <CardTitle>退出当前会话</CardTitle>
          <CardDescription>退出当前浏览器的登录会话，其他设备不受影响。</CardDescription>
        </CardHeader>
        <CardFooter className="justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="outline"><LogOutIcon data-icon="inline-start" />退出登录</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认退出登录？</AlertDialogTitle>
                <AlertDialogDescription>将退出当前浏览器会话并跳转到登录页。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={loggingOut}>取消</AlertDialogCancel>
                <AlertDialogAction disabled={loggingOut} onClick={(event) => { event.preventDefault(); void signOut(); }}>
                  {loggingOut ? <LoaderCircleIcon className="animate-spin" /> : null}确认退出
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>
      <Card className="border border-destructive/30">
        <CardHeader>
          <CardTitle>退出全部会话</CardTitle>
          <CardDescription>撤销该管理员在所有浏览器和设备上的会话，包含当前会话。完成后需要重新登录。</CardDescription>
        </CardHeader>
        <CardFooter className="justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive"><LogOutIcon data-icon="inline-start" />退出全部会话</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认退出全部会话？</AlertDialogTitle>
                <AlertDialogDescription>所有已登录设备会立即失效，当前页面将跳转到登录页。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={revoking}>取消</AlertDialogCancel>
                <AlertDialogAction variant="destructive" disabled={revoking} onClick={(event) => { event.preventDefault(); void revoke(); }}>
                  {revoking ? <LoaderCircleIcon className="animate-spin" /> : null}确认退出
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>
    </div>
  );
}
