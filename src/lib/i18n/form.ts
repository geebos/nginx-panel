import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";
import type { TFunction } from "i18next";
import type { ErrorParams } from "@/lib/api";

// 递归遍历 react-hook-form 的 FieldErrors，把每个 message 字段经 t(message, params) 翻译。
// t() 对非 key 字符串原样返回（如 buildSchema(t) 已翻译的译文、残留中文），安全。
function mapFieldErrors(errors: unknown, t: TFunction): unknown {
  if (Array.isArray(errors)) return errors.map((entry) => mapFieldErrors(entry, t));
  if (errors && typeof errors === "object") {
    const record = errors as Record<string, unknown>;
    const params =
      record.params && typeof record.params === "object"
        ? (record.params as ErrorParams)
        : undefined;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === "message" && typeof value === "string") {
        out[key] = t(value, params ?? {});
      } else if (key === "params") {
        // drop raw params from form state after translating message
        continue;
      } else {
        out[key] = mapFieldErrors(value, t);
      }
    }
    return out;
  }
  return errors;
}

// 包装 zodResolver：schema message 现在是 i18n key（如 "errors:validation.usernameMin"），
// zodResolver 产生的 error.message 是 key；这里递归 t(message, params) 翻译，让 FieldError
// （ui/field.tsx，不能改）直接拿到译文。用 any 规避 react-hook-form 与 zod 版本的类型差异。
export function localizedZodResolver<T extends FieldValues>(
  schema: unknown,
  t: TFunction,
): Resolver<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base: any = zodResolver(schema as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (async (values: any, ctx: any, opts: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await base(values, ctx, opts);
    if (result?.errors) {
      result.errors = mapFieldErrors(result.errors, t);
    }
    return result;
  }) as Resolver<T>;
}
