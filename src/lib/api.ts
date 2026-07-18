import { isTauri } from "@tauri-apps/api/core";
import { fetch as adapterFetch } from "@/lib/adapter/fetch";

import type {
  Todo,
  CreateTodoInput,
  UpdateTodoInput,
} from "@/shared/schemas";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "";
const DEFAULT_TAURI_BASE_URL = "https://template.geebosblog.com";

function isAbsoluteUrl(input: string): boolean {
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(input);
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function resolveApiUrl(input: string): string {
  if (isAbsoluteUrl(input)) return input;

  if (isTauri()) {
    return joinUrl(BASE_URL || DEFAULT_TAURI_BASE_URL, input);
  }

  return BASE_URL ? joinUrl(BASE_URL, input) : input;
}

export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return adapterFetch(resolveApiUrl(input), init);
}

export async function warmupNetworkPermission(): Promise<void> {
  if (!isTauri()) return;

  try {
    await apiFetch("/api/health");
  } catch {
    // iOS only needs a first network attempt to trigger permission.
  }
}

export class ApiError extends Error {
  code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as {
      code?: number;
      message?: string;
      data?: unknown;
    };
    return new ApiError(body.message ?? "请求失败", body.code ?? res.status);
  } catch {
    return new ApiError("请求失败", res.status);
  }
}

export async function listTodos(): Promise<Todo[]> {
  const res = await apiFetch("/api/todos");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as Todo[];
}

export async function createTodo(input: CreateTodoInput): Promise<Todo> {
  const res = await apiFetch("/api/todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as Todo;
}

export async function updateTodo(
  id: string,
  input: UpdateTodoInput,
): Promise<Todo> {
  const res = await apiFetch(`/api/todos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as Todo;
}

export async function deleteTodo(id: string): Promise<void> {
  const res = await apiFetch(`/api/todos/${id}`, { method: "DELETE" });
  if (!res.ok) throw await parseError(res);
  // 204 no body
}
