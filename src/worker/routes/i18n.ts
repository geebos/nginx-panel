import { Hono } from "hono";
import type { AppEnv } from "@/worker/types";
import { isSupportedLocale, type AppLocale } from "@/i18n/settings";
import { errorMessages, pickMessages } from "@/worker/lib/i18n";

// 公开接口（不 requireAuth）：i18n 资源非敏感，且 login 页初始化时未登录也要 fetch。
export const i18nRoute = new Hono<AppEnv>();

i18nRoute.get("/i18n/messages/:locale", (c) => {
  const localeParam = c.req.param("locale");
  if (!isSupportedLocale(localeParam)) {
    return c.json(
      { code: "LOCALE_NOT_SUPPORTED", message: "errors:localeNotSupported" },
      400,
    );
  }
  return c.json({ errors: pickMessages(errorMessages, localeParam as AppLocale) });
});
