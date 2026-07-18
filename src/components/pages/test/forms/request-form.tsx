"use client";

import * as React from "react";
import { ChevronDownIcon, PlusIcon, Trash2Icon, SendIcon, CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

export type HeaderRow = { id: string; key: string; value: string };

export type RequestPayload = {
  method: string;
  url: string;
  headers: Record<string, string>;
};

const METHOD_OPTIONS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

function makeId() {
  return Math.random().toString(36).slice(2);
}

export function RequestForm({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (payload: RequestPayload) => void;
}) {
  const [method, setMethod] = React.useState("GET");
  const [url, setUrl] = React.useState("");
  const [headers, setHeaders] = React.useState<HeaderRow[]>([
    { id: makeId(), key: "", value: "" },
  ]);

  function updateHeader(id: string, field: "key" | "value", val: string) {
    setHeaders((prev) =>
      prev.map((h) => (h.id === id ? { ...h, [field]: val } : h)),
    );
  }

  function addHeader() {
    setHeaders((prev) => [...prev, { id: makeId(), key: "", value: "" }]);
  }

  function removeHeader(id: string) {
    setHeaders((prev) =>
      prev.length <= 1 ? prev : prev.filter((h) => h.id !== id),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const headerMap: Record<string, string> = {};
    for (const h of headers) {
      const key = h.key.trim();
      if (key) headerMap[key] = h.value;
    }
    onSubmit({ method, url: url.trim(), headers: headerMap });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Row 1: method + url + send, as one input group */}
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton className="font-mono font-semibold text-foreground">
                {method}
                <ChevronDownIcon className="size-3.5 opacity-60" />
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {METHOD_OPTIONS.map((m) => (
                <DropdownMenuItem key={m} onClick={() => setMethod(m)}>
                  <span className="font-mono">{m}</span>
                  {m === method && <CheckIcon className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </InputGroupAddon>
        <InputGroupInput
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/api"
          autoComplete="off"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="submit" disabled={loading}>
            {loading ? (
              <Spinner className="size-3.5" />
            ) : (
              <SendIcon className="size-3.5" />
            )}
            请求
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      {/* Row 2: headers kv list, each row an input group */}
      <div className="flex flex-col gap-2">
        {headers.map((h) => (
          <InputGroup key={h.id}>
            <InputGroupInput
              value={h.key}
              onChange={(e) => updateHeader(h.id, "key", e.target.value)}
              placeholder="Header"
              autoComplete="off"
            />
            <InputGroupInput
              value={h.value}
              onChange={(e) => updateHeader(h.id, "value", e.target.value)}
              placeholder="Value"
              autoComplete="off"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                onClick={() => removeHeader(h.id)}
                disabled={headers.length <= 1}
                aria-label="删除该 header"
              >
                <Trash2Icon className="size-3.5" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addHeader}
          className="w-fit"
        >
          <PlusIcon className="size-4" />
          新增 header
        </Button>
      </div>
    </form>
  );
}
