import { isAbsolute, join, normalize, sep } from "node:path";
import {
  BOOTSTRAP_HOSTS,
  domainConfigSchema,
  parseAdvancedSnippet,
  type AccessLogField,
  type DomainConfig,
  type NginxLogSettings,
  type RouteConfig,
} from "@/shared/schemas";

const errorLevels = new Set(["error", "warn", "notice", "info"]);

/**
 * Catch-all material for HTTPS default_server when manager has no TLS of its own.
 * Required so a lone business-domain `listen … ssl` cannot become nginx's implicit
 * default and leak reverse-proxied content on unmatched Host (e.g. https://127.0.0.1).
 * Files are ensured at container start (see docker/scripts/start.mjs).
 */
export const HTTPS_CATCHALL_CERT_PATH = "/data/nginx/tls/default/fullchain.pem";
export const HTTPS_CATCHALL_KEY_PATH = "/data/nginx/tls/default/private.key";

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
  if (startIndex < 0 || endIndex <= startIndex) throw new Error("Nginx template is missing log format markers");
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
    throw new Error("Nginx parameter contains illegal control characters");
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/\$/g, "\\$")}"`;
}

function assertAbsolutePath(value: string, label: string) {
  if (!isAbsolute(value) || /[\r\n\0]/.test(value)) {
    throw new Error(`${label} must be a safe absolute path`);
  }
}

function containedPath(root: string, ...segments: string[]) {
  assertAbsolutePath(root, "Logs root directory");
  const normalizedRoot = normalize(root);
  const target = normalize(join(normalizedRoot, ...segments));
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("Log path is out of bounds");
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
    if (!errorLevels.has(input.logs.errorLevel)) throw new Error("Invalid error log level");
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
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Listen port out of range");
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
  assertAbsolutePath(input.pidPath, "PID path");
  const workerConnections = input.workerConnections ?? 1024;
  if (!Number.isInteger(workerConnections) || workerConnections < 128 || workerConnections > 65535) {
    throw new Error("workerConnections out of range");
  }
  // Temp paths are relative to the nginx prefix (-p). That keeps nginx -t
  // writable under the candidate root on a read-only container filesystem,
  // instead of the compiled-in defaults under /var/cache/nginx.
  return `worker_processes auto;
pid ${quote(input.pidPath)};
error_log stderr warn;

events {
  worker_connections ${workerConnections};
}

http {
  client_body_temp_path client_temp;
  fastcgi_temp_path fastcgi_temp;
  proxy_temp_path proxy_temp;
  scgi_temp_path scgi_temp;
  uwsgi_temp_path uwsgi_temp;

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

export type RenderManagerRootInput = {
  bootstrapHosts?: readonly string[];
  userHostnames: string[];
  listeners?: { http: number; https: number };
  tls?: { fullchainPath: string; privateKeyPath: string };
  /** HTTPS default_server material when manager has no TLS (tests / overrides). */
  httpsDefaultTls?: { fullchainPath: string; privateKeyPath: string };
  forceHttpsOnBound?: boolean;
  uiRoot?: string;
  apiUpstream?: string;
};

function renderManagerLocations(input: {
  uiRoot: string;
  apiUpstream: string;
  ssl: boolean;
}) {
  const apiLines = [
    "location /api/ {",
    `  proxy_pass ${input.apiUpstream};`,
    "  proxy_set_header Host $host;",
    "  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "  proxy_set_header X-Forwarded-Proto $scheme;",
    "  proxy_set_header X-Request-Id $request_id;",
    '  proxy_set_header X-Internal-Health-Check "";',
    "}",
  ];
  // Prefer $uri/index.html over bare $uri/ so a locale directory without an
  // index (e.g. /en/ before export) never hits autoindex-off 403.
  const uiLines = [
    "location / {",
    "  index index.html;",
    "  try_files $uri $uri/index.html $uri.html =404;",
    "}",
  ];
  return [
    "location = /internal/health {",
    "  return 404;",
    "}",
    "",
    ...apiLines,
    "",
    ...uiLines,
  ];
}

function renderManagerServer(input: {
  listen: string;
  hostnames: string[];
  uiRoot: string;
  apiUpstream: string;
  certificate?: { fullchainPath: string; privateKeyPath: string };
  redirectHttps?: boolean;
}) {
  const lines = [
    "server {",
    `  listen ${input.listen};`,
    `  server_name ${input.hostnames.join(" ")};`,
  ];
  if (input.certificate) {
    lines.push(
      `  ssl_certificate ${quote(input.certificate.fullchainPath)};`,
      `  ssl_certificate_key ${quote(input.certificate.privateKeyPath)};`,
    );
  }
  if (input.redirectHttps) {
    lines.push("  return 308 https://$host$request_uri;");
  } else {
    lines.push(`  root ${quote(input.uiRoot)};`, "");
    lines.push(...indent(renderManagerLocations({
      uiRoot: input.uiRoot,
      apiUpstream: input.apiUpstream,
      ssl: Boolean(input.certificate),
    })));
  }
  lines.push("}");
  return lines;
}

/**
 * Renders the full production root nginx.conf with split manager servers:
 * bootstrap-http (localhost/127.0.0.1, never 308), optional bound-http, optional bound-ssl.
 */
export function renderManagerRoot(input: RenderManagerRootInput) {
  const bootstrapHosts = [...(input.bootstrapHosts ?? BOOTSTRAP_HOSTS)];
  const userHostnames = [...new Set(input.userHostnames.map((h) => h.toLowerCase().replace(/\.$/, "")))].filter(Boolean);
  const listeners = input.listeners ?? { http: 8080, https: 8443 };
  const uiRoot = input.uiRoot ?? "/opt/nginx-manager/ui";
  const apiUpstream = input.apiUpstream ?? "http://127.0.0.1:8787";
  const forceHttpsOnBound = input.forceHttpsOnBound ?? true;
  const tls = input.tls;

  for (const port of [listeners.http, listeners.https]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Listen port out of range");
  }
  assertAbsolutePath(uiRoot, "UI root");
  if (tls) {
    assertAbsolutePath(tls.fullchainPath, "TLS fullchain");
    assertAbsolutePath(tls.privateKeyPath, "TLS private key");
  }

  const sections: string[] = [];

  // default_server HTTP
  sections.push([
    "server {",
    `  listen ${listeners.http} default_server;`,
    "  server_name _;",
    "",
    "  location ^~ /.well-known/acme-challenge/ {",
    "    proxy_pass http://127.0.0.1:8787;",
    "    proxy_set_header Host $host;",
    "    proxy_pass_request_body off;",
    "  }",
    "",
    "  location / { return 444; }",
    "}",
  ].join("\n"));

  // bootstrap-http — never 308
  sections.push(renderManagerServer({
    listen: String(listeners.http),
    hostnames: bootstrapHosts,
    uiRoot,
    apiUpstream,
  }).join("\n"));

  // bound-http
  if (userHostnames.length > 0) {
    sections.push(renderManagerServer({
      listen: String(listeners.http),
      hostnames: userHostnames,
      uiRoot,
      apiUpstream,
      redirectHttps: Boolean(tls) && forceHttpsOnBound,
    }).join("\n"));
  }

  // Always own HTTPS default_server. Without this, the first business domain
  // that listens on 8443 ssl becomes the implicit default and unmatched Host
  // (including https://127.0.0.1) is reverse-proxied to that domain.
  // nginx requires ssl_* on any ssl listen, so fall back to the catch-all cert
  // when manager has no TLS of its own.
  const httpsDefaultTls = tls ?? input.httpsDefaultTls ?? {
    fullchainPath: process.env.NGINX_HTTPS_DEFAULT_CERT || HTTPS_CATCHALL_CERT_PATH,
    privateKeyPath: process.env.NGINX_HTTPS_DEFAULT_KEY || HTTPS_CATCHALL_KEY_PATH,
  };
  assertAbsolutePath(httpsDefaultTls.fullchainPath, "HTTPS default fullchain");
  assertAbsolutePath(httpsDefaultTls.privateKeyPath, "HTTPS default private key");
  sections.push([
    "server {",
    `  listen ${listeners.https} ssl default_server;`,
    "  server_name _;",
    `  ssl_certificate ${quote(httpsDefaultTls.fullchainPath)};`,
    `  ssl_certificate_key ${quote(httpsDefaultTls.privateKeyPath)};`,
    "  return 444;",
    "}",
  ].join("\n"));

  if (tls && userHostnames.length > 0) {
    sections.push(renderManagerServer({
      listen: `${listeners.https} ssl`,
      hostnames: userHostnames,
      uiRoot,
      apiUpstream,
      certificate: tls,
    }).join("\n"));
  }

  // internal health
  sections.push([
    "server {",
    "  listen 127.0.0.1:8082;",
    "  server_name _;",
    "",
    "  location = /internal/health {",
    "    proxy_pass http://127.0.0.1:8787/internal/health;",
    "    proxy_set_header Host 127.0.0.1;",
    "    proxy_set_header X-Internal-Health-Check 1;",
    "  }",
    "}",
  ].join("\n"));

  return `worker_processes auto;
pid /run/nginx/nginx.pid;
error_log stderr warn;

events {
  worker_connections 1024;
}

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log off;
  sendfile on;
  keepalive_timeout 65;
  client_body_temp_path /run/nginx/client_temp;
  fastcgi_temp_path /run/nginx/fastcgi_temp;
  proxy_temp_path /run/nginx/proxy_temp;
  scgi_temp_path /run/nginx/scgi_temp;
  uwsgi_temp_path /run/nginx/uwsgi_temp;

  map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
  }

  # nginx-manager:log-format:start
  log_format domain_manager escape=json
    '{"timestamp":"$time_iso8601","domain":"$host","method":"$request_method",'
    '"path":"$uri","request_uri":"$request_uri","status":"$status",'
    '"request_time":"$request_time"}';
  # nginx-manager:log-format:end

${sections.map((block) => indent(block.split("\n")).join("\n")).join("\n\n")}

  include domains/*.conf;
}
`;
}

