import { isTauri } from "@tauri-apps/api/core";
import {
  confirm as tauriConfirm,
  message as tauriMessage,
} from "@tauri-apps/plugin-dialog";
import type {
  ConfirmDialogOptions,
  MessageDialogOptions,
  MessageDialogResult,
} from "@tauri-apps/plugin-dialog";

export type AdapterConfirmOptions = string | ConfirmDialogOptions;
export type AdapterMessageOptions = string | MessageDialogOptions;

function browserDialogMessage(
  value: string,
  options?: AdapterConfirmOptions | AdapterMessageOptions,
): string {
  const title = typeof options === "string" ? options : options?.title;
  return title ? `${title}\n\n${value}` : value;
}

export async function confirm(
  value: string,
  options?: AdapterConfirmOptions,
): Promise<boolean> {
  if (isTauri()) {
    return tauriConfirm(value, options);
  }

  if (typeof globalThis.confirm !== "function") return false;
  return globalThis.confirm(browserDialogMessage(value, options));
}

export async function message(
  value: string,
  options?: AdapterMessageOptions,
): Promise<MessageDialogResult> {
  if (isTauri()) {
    return tauriMessage(value, options);
  }

  if (typeof globalThis.alert === "function") {
    globalThis.alert(browserDialogMessage(value, options));
  }

  return "Ok";
}
