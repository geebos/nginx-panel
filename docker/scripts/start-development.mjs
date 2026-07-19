import { spawn, spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { refreshActiveRoot } from "./runtime-root.mjs";

const runtimeRoot = process.env.NGINX_RUNTIME_ROOT || "/data/nginx";
const activePath = join(runtimeRoot, "active");
const bootstrapRoot = join(runtimeRoot, "revisions", "bootstrap");
const templatePath = process.env.NGINX_TEMPLATE_FILE || "/etc/nginx/nginx.development.conf";
const nginxConfig = readFileSync(templatePath, "utf8");
mkdirSync(join(bootstrapRoot, "domains"), { recursive: true });
writeFileSync(join(bootstrapRoot, "nginx.conf"), nginxConfig, { mode: 0o640 });
try {
  const activeStat = lstatSync(activePath);
  if (!activeStat.isSymbolicLink()) throw new Error("Development runtime active path must be a symlink");
  const target = readlinkSync(activePath);
  if (target.includes("..") || isAbsolute(target)) throw new Error("Development runtime active symlink target is unsafe");
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    const nextActive = join(runtimeRoot, ".active-bootstrap");
    symlinkSync("revisions/bootstrap", nextActive);
    renameSync(nextActive, activePath);
  } else {
    throw error;
  }
}

refreshActiveRoot({
  runtimeRoot,
  rootConfig: nginxConfig,
  validate: (candidateRoot) => {
    const result = spawnSync("/usr/sbin/nginx", ["-p", `${candidateRoot}/`, "-t", "-c", "nginx.conf"], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("refreshed development nginx configuration test failed");
  },
});

const configTest = spawnSync(
  "/usr/sbin/nginx",
  ["-p", `${activePath}/`, "-t", "-c", "nginx.conf"],
  { stdio: "inherit" },
);
if (configTest.status !== 0) throw new Error("development nginx configuration test failed");

const children = [
  spawn("pnpm", ["exec", "next", "dev", "-H", "127.0.0.1", "-p", "3001"], {
    cwd: "/app",
    env: process.env,
    stdio: "inherit",
  }),
  spawn("pnpm", ["exec", "tsx", "src/worker/serve.ts"], {
    cwd: "/app",
    env: { ...process.env, DB_SQLITE_DIR: "/app/.sqlite", PORT: "8787" },
    stdio: "inherit",
  }),
  spawn("/usr/sbin/nginx", ["-p", `${activePath}/`, "-c", "nginx.conf", "-g", "daemon off;"], {
    stdio: "inherit",
  }),
];

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;

  children[0].kill("SIGTERM");
  children[1].kill("SIGTERM");
  children[2].kill("SIGQUIT");

  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

for (const [index, child] of children.entries()) {
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[development] process ${index} exited unexpectedly (${code ?? signal})`);
      shutdown(code ?? 1);
    }
  });
}
