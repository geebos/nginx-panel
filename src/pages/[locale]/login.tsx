import { getLocaleStaticPaths, makeStaticProps } from "@/lib/i18n-static";
import { Page } from "@/components/layout/page";
import { Card, CardContent } from "@/components/ui/card";
import { LoginForm } from "@/components/pages/login/forms/login-form";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "login"]);

export default function LoginPage() {
  return (
    <Page className="min-h-[100dvh] items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md border border-border">
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </Page>
  );
}
