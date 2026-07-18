"use client";

import * as React from "react";
import { toast } from "sonner";

import { Page } from "@/components/layout/page";
import { Section } from "@/components/ui/section";
import {
  RequestForm,
  type RequestPayload,
} from "@/components/pages/test/forms/request-form";
import {
  ResponseViewer,
  type ResponseData,
} from "@/components/pages/test/response-viewer";
import { request } from "@/lib/adapter/request";

export default function TestPage() {
  const [loading, setLoading] = React.useState(false);
  const [response, setResponse] = React.useState<ResponseData | null>(null);

  async function handleSubmit({ method, url, headers }: RequestPayload) {
    if (!url) {
      toast.error("请输入 URL");
      return;
    }

    setLoading(true);
    try {
      const res = await request(url, { method, headers });
      const headerMap: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headerMap[key] = value;
      });
      const body = await res.text();
      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: headerMap,
        body,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "请求失败";
      toast.error(msg);
      setResponse({
        status: 0,
        statusText: "Error",
        headers: {},
        body: msg,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-8">
        <header>
          <h1 className="font-heading text-[28px] font-semibold tracking-tight">
            Test
          </h1>
        </header>

        <Section className="sticky top-[env(safe-area-inset-top,0px)] z-10 rounded-lg border border-border bg-card p-4">
          <RequestForm loading={loading} onSubmit={handleSubmit} />
        </Section>

        <Section>
          {response ? (
            <ResponseViewer data={response} />
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
              发起请求后在此查看响应
            </div>
          )}
        </Section>
      </div>
    </Page>
  );
}
