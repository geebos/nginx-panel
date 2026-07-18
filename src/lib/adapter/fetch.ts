import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

type AdapterFetchInput = URL | Request | string;

export function fetch(
  input: AdapterFetchInput,
  init?: RequestInit,
): Promise<Response> {
  return isTauri()
    ? tauriFetch(input, init)
    : globalThis.fetch(input, init);
}
