import type { DomainConfig } from "@/shared/schemas";

export type SemanticChange = {
  section: "domain" | "routes" | "ssl" | "headers" | "advanced";
  kind: "added" | "removed" | "changed";
  label: string;
  before?: string;
  after?: string;
};

function value(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function diffDomainConfigs(base: DomainConfig, target: DomainConfig) {
  const changes: SemanticChange[] = [];
  if (base.primaryHostname !== target.primaryHostname) {
    changes.push({ section: "domain", kind: "changed", label: "Primary Domain", before: base.primaryHostname, after: target.primaryHostname });
  }
  if (JSON.stringify(base.aliases) !== JSON.stringify(target.aliases)) {
    changes.push({ section: "domain", kind: "changed", label: "Aliases", before: base.aliases.join(", "), after: target.aliases.join(", ") });
  }

  const baseRoutes = new Map(base.routes.map((route) => [route.id, route]));
  const targetRoutes = new Map(target.routes.map((route) => [route.id, route]));
  for (const route of base.routes) {
    const next = targetRoutes.get(route.id);
    if (!next) changes.push({ section: "routes", kind: "removed", label: route.path, before: value(route) });
    else if (JSON.stringify(route) !== JSON.stringify(next)) changes.push({ section: "routes", kind: "changed", label: route.path, before: value(route), after: value(next) });
  }
  for (const route of target.routes) {
    if (!baseRoutes.has(route.id)) changes.push({ section: "routes", kind: "added", label: route.path, after: value(route) });
  }

  if (JSON.stringify(base.ssl) !== JSON.stringify(target.ssl)) {
    changes.push({ section: "ssl", kind: "changed", label: "HTTPS configuration", before: value(base.ssl), after: value(target.ssl) });
  }
  if (JSON.stringify(base.headers) !== JSON.stringify(target.headers)) {
    changes.push({ section: "headers", kind: "changed", label: "Headers", before: value(base.headers), after: value(target.headers) });
  }
  if (base.advanced.serverSnippet !== target.advanced.serverSnippet) {
    changes.push({ section: "advanced", kind: "changed", label: "Server snippet", before: base.advanced.serverSnippet, after: target.advanced.serverSnippet });
  }
  return changes;
}
