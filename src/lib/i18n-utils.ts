import { isTauri } from "@tauri-apps/api/core";
import { locale as getTauriLocale } from "@tauri-apps/plugin-os";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  normalizeLocale,
  PREFERRED_LOCALE_KEY,
  type AppLocale,
} from "@/i18n/settings";

export const LOCAL_URL_BASE = "https://local.invalid";

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:|#|\/\/)/.test(href);
}

export function localizePath(href: string, locale: AppLocale): string {
  if (!href) return `/${locale}/`;
  if (isExternalHref(href)) return href;

  const url = new URL(href.startsWith("/") ? href : `/${href}`, LOCAL_URL_BASE);
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments.length > 0 && isSupportedLocale(segments[0])) {
    segments[0] = locale;
  } else {
    segments.unshift(locale);
  }

  return `/${segments.join("/")}/${url.search}${url.hash}`;
}

export function stripLocalePrefix(path: string): string {
  if (isExternalHref(path)) return path;
  const url = new URL(path.startsWith("/") ? path : `/${path}`, LOCAL_URL_BASE);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length > 0 && isSupportedLocale(segments[0])) segments.shift();
  const pathname = segments.length === 0 ? "/" : `/${segments.join("/")}`;
  return `${pathname}${url.search}${url.hash}`;
}

export function replacePathLocale(
  currentPath: string,
  nextLocale: AppLocale,
): string {
  return localizePath(currentPath, nextLocale);
}

export async function detectInitialLocale(): Promise<AppLocale> {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(PREFERRED_LOCALE_KEY);
    if (stored && isSupportedLocale(stored)) return stored;
  }

  if (isTauri()) {
    try {
      const systemLocale = await getTauriLocale();
      if (systemLocale) return normalizeLocale(systemLocale);
    } catch {
      // Fall back to the configured default locale.
    }
  }

  return DEFAULT_LOCALE;
}
