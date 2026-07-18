import { invoke, isTauri } from "@tauri-apps/api/core";

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array;
}

type ProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: number[];
};

function toBytes(body: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(body); // ArrayBuffer
}

/**
 * Transparent HTTP request routed through the Rust `proxy` command.
 * Only available in the Tauri environment; throws otherwise.
 */
export async function request(
  url: string,
  init?: RequestOptions,
): Promise<Response> {
  if (!isTauri()) {
    throw new Error("request() is only available in the Tauri environment");
  }

  const res = await invoke<ProxyResponse>("proxy", {
    args: {
      url,
      method: init?.method,
      headers: init?.headers,
      body: init?.body != null ? Array.from(toBytes(init.body)) : undefined,
    },
  });

  // 204/304 forbid a body; passing one to the Response constructor throws.
  const hasNoBodyStatus = res.status === 204 || res.status === 304;
  return new Response(hasNoBodyStatus ? null : new Uint8Array(res.body), {
    status: res.status,
    headers: res.headers,
  });
}
