import { resolve, sep } from "node:path";
import { BusinessError } from "@/worker/lib/errors";

export function controlledLogPath(root: string, hostname: string, filename: string) {
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, hostname, filename);
  if (!target.startsWith(`${normalizedRoot}${sep}`)) throw new BusinessError("日志路径无效", 400, "LOG_FILE_UNAVAILABLE");
  return target;
}
