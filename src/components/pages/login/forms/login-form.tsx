import * as React from "react";
import { useRouter } from "next/router";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
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
import { safeRedirectPath } from "@/lib/safe-redirect";
import { passwordSchema, usernameSchema } from "@/shared/schemas";
import { useApiQuery } from "@/hooks/use-api-query";
import { useLocale } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n-utils";

const formSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "请输入密码").max(128),
  confirmPassword: z.string().max(128),
  remember: z.boolean(),
});

type LoginFormValues = z.infer<typeof formSchema>;

export function LoginForm() {
  const router = useRouter();
  const locale = useLocale();
  const setupQuery = useApiQuery(getSetupStatus);
  const [showPassword, setShowPassword] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const setupRequired = setupQuery.data?.setupRequired ?? false;
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: "", password: "", confirmPassword: "", remember: false },
  });

  React.useEffect(() => {
    if (!router.isReady) return;
    void getCurrentUser()
      .then(() => router.replace(localizePath("/dashboard", locale)))
      .catch(() => undefined);
  }, [router, locale]);

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    if (setupRequired) {
      const passwordResult = passwordSchema.safeParse(values.password);
      if (!passwordResult.success) {
        form.setError("password", { message: passwordResult.error.issues[0]?.message });
        return;
      }
      if (values.password !== values.confirmPassword) {
        form.setError("confirmPassword", { message: "两次输入的密码不一致" });
        return;
      }
    }

    try {
      if (setupRequired) {
        await setupAdmin({ username: values.username, password: values.password });
      } else {
        await login({ username: values.username, password: values.password, remember: values.remember });
      }
      await router.replace(localizePath(safeRedirectPath(router.query.redirect), locale));
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "登录失败");
    }
  });

  if (setupQuery.loading && !setupQuery.data) {
    return <Skeleton className="h-80 w-full" />;
  }

  if (setupQuery.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>无法连接管理 API</AlertTitle>
        <AlertDescription>{setupQuery.error.message}</AlertDescription>
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
            {setupRequired ? "初始化管理员" : "登录 Nginx Manager"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {setupRequired
              ? "创建唯一管理员账号。完成后初始化入口将永久关闭。"
              : "登录后管理域名、配置版本和发布任务。"}
          </p>
        </div>
      </div>

      {serverError ? (
        <Alert variant="destructive">
          <AlertTitle>{setupRequired ? "初始化失败" : "登录失败"}</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field data-invalid={Boolean(form.formState.errors.username)}>
          <FieldLabel htmlFor="username">用户名</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="username"
              autoComplete="username"
              aria-invalid={Boolean(form.formState.errors.username)}
              {...form.register("username")}
            />
          </InputGroup>
          <FieldDescription>使用小写字母、数字、点、下划线或连字符。</FieldDescription>
          <FieldError errors={[form.formState.errors.username]} />
        </Field>

        <Field data-invalid={Boolean(form.formState.errors.password)}>
          <FieldLabel htmlFor="password">密码</FieldLabel>
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
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {setupRequired ? <FieldDescription>至少 12 个字符。</FieldDescription> : null}
          <FieldError errors={[form.formState.errors.password]} />
        </Field>

        {setupRequired ? (
          <Field data-invalid={Boolean(form.formState.errors.confirmPassword)}>
            <FieldLabel htmlFor="confirmPassword">确认密码</FieldLabel>
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
                  <FieldLabel htmlFor="remember">保持登录</FieldLabel>
                  <FieldDescription>按实例安全策略延长此设备的会话。</FieldDescription>
                </FieldContent>
              </Field>
            )}
          />
        )}
      </FieldGroup>

      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : null}
        {setupRequired ? "创建管理员" : "登录"}
      </Button>
    </form>
  );
}
