import { isAbsolute, join, normalize, sep } from "node:path";
import {
  domainConfigSchema,
  parseAdvancedSnippet,
  type AccessLogField,
  type DomainConfig,
  type NginxLogSettings,
  type RouteConfig,
} from "@/shared/schemas";

const errorLevels = new Set(["error", "warn", "notice", "info"]);

const accessLogVariables: Record<AccessLogField, string> = {
  timestamp: "$time_iso8601",
  domain: "$host",
  method: "$request_method",
  path: "$uri",
  request_uri: "$request_uri",
  status: "$status",
  request_time: "$request_time",
  client_ip: "$remote_addr",
  upstream_addr: "$upstream_addr",
  upstream_status: "$upstream_status",
  upstream_time: "$upstream_response_time",
};

export function renderAccessLogFormat(settings: Pick<NginxLogSettings, "accessFields">) {
  const fields = settings.accessFields.map((field) => `"${field}":"${accessLogVariables[field]}"`);
  return `  log_format domain_manager escape=json '{${fields.join(",")}}';`;
}

export function injectAccessLogFormat(template: string, settings: Pick<NginxLogSettings, "accessFields">) {
  const start = "  # nginx-manager:log-format:start";
  const end = "  # nginx-manager:log-format:end";
  const startIndex = template.indexOf(start);
  const endIndex = template.indexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) throw new Error("Nginx 模板缺少日志格式标记");
  return `${template.slice(0, startIndex)}${start}\n${renderAccessLogFormat(settings)}\n${template.slice(endIndex)}`;
}

export type RuntimeLogSettings = {
  root: string;
  errorLevel: "error" | "warn" | "notice" | "info";
};

export type RenderDomainConfigInput =
  | { mode: "preview"; snapshot: DomainConfig }
  | {
      mode: "runtime";
      domainId: string;
      snapshot: DomainConfig;
      enabled: boolean;
      logs: RuntimeLogSettings;
      listeners?: { http: number; https: number };
      certificate?: { fullchainPath: string; privateKeyPath: string };
    };

export type RenderRootConfigInput = {
  pidPath: string;
  workerConnections?: number;
};

function indent(lines: string[], spaces = 2) {
  const prefix = " ".repeat(spaces);
  return lines.map((line) => (line ? `${prefix}${line}` : line));
}

function quote(value: string) {
  if (/[\r\n\0]/.test(value)) {
    throw new Error("Nginx 参数包含非法控制字符");
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/\$/g, "\\$")}"`;
}

function assertAbsolutePath(value: string, label: string) {
  if (!isAbsolute(value) || /[\r\n\0]/.test(value)) {
    throw new Error(`${label} 必须是安全的绝对路径`);
  }
}

function containedPath(root: string, ...segments: string[]) {
  assertAbsolutePath(root, "日志根目录");
  const normalizedRoot = normalize(root);
  const target = normalize(join(normalizedRoot, ...segments));
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("日志路径越界");
  }
  return target;
}

function renderAdvanced(snippet: string) {
  return parseAdvancedSnippet(snippet);
}

function renderHeaders(snapshot: DomainConfig, routeId?: string) {
  return snapshot.headers
    .filter(
      (header) =>
        header.enabled &&
        (routeId
          ? header.scope.type === "route" && header.scope.routeId === routeId
          : header.scope.type === "server"),
    )
    .map(
      (header) =>
        `add_header ${header.name} ${quote(header.value)}${header.always ? " always" : ""};`,
    );
}

function renderRoute(route: RouteConfig, snapshot: DomainConfig) {
  const body: string[] = [];
  if (route.type === "proxy") {
    body.push(
      `proxy_pass ${quote(route.target)};`,
      "proxy_set_header X-Real-IP $remote_addr;",
      "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
      "proxy_set_header X-Forwarded-Proto $scheme;",
      "proxy_set_header X-Forwarded-Host $host;",
      `proxy_set_header Host ${route.preserveHost ? "$host" : "$proxy_host"};`,
      `proxy_connect_timeout ${route.connectTimeoutSeconds}s;`,
      `proxy_read_timeout ${route.readTimeoutSeconds}s;`,
      `proxy_send_timeout ${route.sendTimeoutSeconds}s;`,
    );
    if (route.websocket) {
      body.push(
        "proxy_http_version 1.1;",
        "proxy_set_header Upgrade $http_upgrade;",
        "proxy_set_header Connection $connection_upgrade;",
      );
    }
  } else if (route.type === "static") {
    body.push(`root ${quote(route.root)};`, `index ${quote(route.index)};`);
    if (route.spaFallback) body.push(`try_files $uri $uri/ ${quote(`/${route.index}`)};`);
  } else {
    body.push(`return ${route.statusCode} ${quote(route.target)};`);
  }
  body.push(...renderHeaders(snapshot, route.id));
  return [`location ${quote(route.path)} {`, ...indent(body), "}"];
}

function renderBusinessLocations(snapshot: DomainConfig) {
  const routes = snapshot.routes
    .filter((route) => route.enabled)
    .sort((left, right) => right.path.length - left.path.length || left.path.localeCompare(right.path));
  const lines = routes.flatMap((route) => [...renderRoute(route, snapshot), ""]);
  if (!routes.some((route) => route.path === "/")) {
    lines.push("location / {", "  return 404;", "}");
  }
  return lines;
}

function renderChallengeLocation() {
  return [
    "location ^~ /.well-known/acme-challenge/ {",
    "  proxy_pass http://127.0.0.1:8787;",
    "  proxy_set_header Host $host;",
    "  proxy_set_header X-Request-Id $request_id;",
    "  proxy_pass_request_body off;",
    "}",
  ];
}

function renderServer(input: {
  listen: string;
  hostnames: string[];
  snapshot: DomainConfig;
  enabled: boolean;
  challenge: boolean;
  redirectHttps: boolean;
  certificate?: { fullchainPath: string; privateKeyPath: string };
  logLines: string[];
}) {
  const lines = [`server {`, `  listen ${input.listen};`, `  server_name ${input.hostnames.join(" ")};`];
  if (input.certificate) {
    lines.push(
      `  ssl_certificate ${quote(input.certificate.fullchainPath)};`,
      `  ssl_certificate_key ${quote(input.certificate.privateKeyPath)};`,
    );
  }
  lines.push(...indent(input.logLines));
  if (input.challenge) lines.push(...indent(renderChallengeLocation()), "");
  if (!input.enabled) {
    lines.push("  location / {", "    return 503;", "  }");
  } else if (input.redirectHttps) {
    lines.push("  location / {", "    return 308 https://$host$request_uri;", "  }");
  } else {
    lines.push(...indent(renderHeaders(input.snapshot)), ...indent(renderAdvanced(input.snapshot.advanced.serverSnippet)));
    if (input.snapshot.advanced.serverSnippet.trim()) lines.push("");
    lines.push(...indent(renderBusinessLocations(input.snapshot)));
  }
  lines.push("}");
  return lines;
}

export function renderDomainConfig(input: RenderDomainConfigInput) {
  const snapshot = domainConfigSchema.parse(input.snapshot);
  const hostnames = [snapshot.primaryHostname, ...snapshot.aliases];
  const enabled = input.mode === "preview" ? true : input.enabled;
  const logLines: string[] = [];
  if (input.mode === "runtime") {
    if (!errorLevels.has(input.logs.errorLevel)) throw new Error("无效的 error log level");
    const domainLogRoot = containedPath(input.logs.root, snapshot.primaryHostname);
    logLines.push(
      `access_log ${quote(join(domainLogRoot, "access.log"))} domain_manager;`,
      `error_log ${quote(join(domainLogRoot, "error.log"))} ${input.logs.errorLevel};`,
    );
  }

  const certificate = snapshot.ssl.certificateId
    ? input.mode === "preview"
      ? {
          fullchainPath: `<certificate:${snapshot.ssl.certificateId}:fullchain>`,
          privateKeyPath: `<certificate:${snapshot.ssl.certificateId}:private-key>`,
        }
      : input.certificate
    : undefined;
  const listeners = input.mode === "runtime" ? input.listeners ?? { http: 80, https: 443 } : { http: 80, https: 443 };
  for (const port of [listeners.http, listeners.https]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("监听端口超出范围");
  }

  const http = renderServer({
    listen: String(listeners.http),
    hostnames,
    snapshot,
    enabled,
    challenge: true,
    redirectHttps: enabled && Boolean(certificate) && snapshot.ssl.forceHttps,
    logLines,
  });
  const servers = [...http];
  if (certificate) {
    servers.push(
      "",
      ...renderServer({
        listen: `${listeners.https} ssl`,
        hostnames,
        snapshot,
        enabled,
        challenge: false,
        redirectHttps: false,
        certificate,
        logLines,
      }),
    );
  }
  return `${servers.join("\n")}\n`;
}

export function renderDomainPreview(snapshot: DomainConfig) {
  return renderDomainConfig({ mode: "preview", snapshot });
}

export function renderRootConfig(input: RenderRootConfigInput) {
  assertAbsolutePath(input.pidPath, "PID 路径");
  const workerConnections = input.workerConnections ?? 1024;
  if (!Number.isInteger(workerConnections) || workerConnections < 128 || workerConnections > 65535) {
    throw new Error("workerConnections 超出范围");
  }
  return `worker_processes auto;
pid ${quote(input.pidPath)};
error_log stderr warn;

events {
  worker_connections ${workerConnections};
}

http {
  map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
  }

  log_format domain_manager escape=json
    '{"timestamp":"$time_iso8601","domain":"$host","method":"$request_method",'
    '"path":"$uri","request_uri":"$request_uri","status":"$status",'
    '"request_time":"$request_time"}';

  include domains/*.conf;
}
`;
}
