import errorMessagesJson from "@/worker/lib/i18n/error-messages.json";
import {
  SUPPORTED_LOCALES,
  type AppLocale,
  type Messages,
} from "@/i18n/settings";

export const errorMessages: Messages =
  errorMessagesJson as unknown as Messages;

// 递归选 locale 叶子，逻辑同前端 src/lib/i18n/static.ts 的 pickLocale，
// 但不 import 前端 messages，纯函数供 worker 复用。
export function pickMessages(node: unknown, locale: AppLocale): Messages {
  if (node === null || typeof node !== "object") {
    return node as unknown as Messages;
  }
  if (Array.isArray(node)) {
    return node.map((item) => pickMessages(item, locale)) as unknown as Messages;
  }

  const entries = Object.entries(node as Record<string, unknown>);
  const isLeaf =
    entries.length > 0 &&
    entries.every(
      ([key, value]) =>
        (SUPPORTED_LOCALES as readonly string[]).includes(key) &&
        typeof value === "string",
    );

  if (isLeaf) {
    return (node as Record<string, string>)[locale] as unknown as Messages;
  }

  const result: Messages = {};
  for (const [key, value] of entries) result[key] = pickMessages(value, locale);
  return result;
}
