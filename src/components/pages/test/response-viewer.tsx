"use client";

export type ResponseData = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
};

function statusTone(status: number) {
  if (status >= 200 && status < 300) return "text-emerald-600";
  if (status >= 300 && status < 400) return "text-blue-600";
  if (status >= 400 && status < 500) return "text-amber-600";
  return "text-red-600";
}

export function ResponseViewer({ data }: { data: ResponseData }) {
  const headerLines = Object.entries(data.headers).map(
    ([k, v]) => `${k}: ${v}`,
  );

  return (
    <pre className="whitespace-pre-wrap break-words rounded-lg border border-border bg-card p-4 font-mono text-xs leading-relaxed">
      <span className={statusTone(data.status)}>
        {data.status} {data.statusText}
      </span>
      {"\n"}
      {headerLines.join("\n")}
      {headerLines.length > 0 ? "\n" : ""}
      {"\n"}
      {data.body}
    </pre>
  );
}
