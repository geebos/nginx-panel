import { Page } from "@/components/layout/page";

export default function Home() {
  return (
    <Page>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 py-8">
        <h1 className="font-heading text-[28px] font-semibold tracking-tight">
          Nginx Panel
        </h1>
        <p className="text-sm text-muted-foreground">项目首页占位</p>
      </div>
    </Page>
  );
}
