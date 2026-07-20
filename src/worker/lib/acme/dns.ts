import { Resolver, resolve4, resolve6, resolveNs } from "node:dns/promises";

export type DnsPropagationResult = {
  authoritative: boolean;
  recursiveVisible: number;
};

export interface DnsPropagationChecker {
  check(recordName: string, recordValue: string): Promise<DnsPropagationResult>;
}

const recursiveResolvers = ["1.1.1.1", "8.8.8.8"];

function normalize(value: string) {
  return value.toLowerCase().replace(/\.$/, "");
}

function containsValue(records: string[][], expected: string) {
  return records.some((parts) => parts.join("") === expected);
}

function isMissingRecord(error: unknown) {
  return error && typeof error === "object" && "code" in error
    && ["ENODATA", "ENOTFOUND", "ESERVFAIL", "EREFUSED"].includes(String(error.code));
}

async function resolverAddresses(hostnames: string[]) {
  const addresses = new Set<string>();
  await Promise.all(hostnames.map(async (hostname) => {
    const [ipv4, ipv6] = await Promise.all([
      resolve4(hostname).catch(() => []),
      resolve6(hostname).catch(() => []),
    ]);
    for (const address of [...ipv4, ...ipv6]) addresses.add(address);
  }));
  return [...addresses];
}

async function findAuthoritativeServers(recordName: string) {
  const labels = normalize(recordName).split(".");
  for (let index = 0; index < labels.length - 1; index += 1) {
    try {
      const nameservers = await resolveNs(labels.slice(index).join("."));
      const addresses = await resolverAddresses(nameservers);
      if (addresses.length > 0) return addresses;
    } catch (error) {
      if (!isMissingRecord(error)) throw error;
    }
  }
  return [];
}

async function queryTxt(recordName: string, servers: string[], depth = 0, visited = new Set<string>()): Promise<string[][]> {
  const name = normalize(recordName);
  if (depth > 5 || visited.has(name)) return [];
  visited.add(name);
  const resolver = new Resolver({ timeout: 3_000, tries: 1 });
  resolver.setServers(servers);
  try {
    return await resolver.resolveTxt(name);
  } catch (error) {
    if (!isMissingRecord(error)) throw error;
  }
  try {
    const cname = await resolver.resolveCname(name);
    if (!cname[0]) return [];
    const delegatedServers = await findAuthoritativeServers(cname[0]);
    if (delegatedServers.length === 0) return [];
    return queryTxt(cname[0], delegatedServers, depth + 1, visited);
  } catch (error) {
    if (isMissingRecord(error)) return [];
    throw error;
  }
}

export class NodeDnsPropagationChecker implements DnsPropagationChecker {
  async check(recordName: string, recordValue: string): Promise<DnsPropagationResult> {
    const authoritativeServers = await findAuthoritativeServers(recordName);
    const authoritativeRecords = authoritativeServers.length > 0
      ? await queryTxt(recordName, authoritativeServers).catch(() => [])
      : [];
    const recursiveResults = await Promise.all(recursiveResolvers.map(async (server) => {
      const records = await queryTxt(recordName, [server]).catch(() => []);
      return containsValue(records, recordValue);
    }));
    return {
      authoritative: containsValue(authoritativeRecords, recordValue),
      recursiveVisible: recursiveResults.filter(Boolean).length,
    };
  }
}

let defaultChecker: DnsPropagationChecker | null = null;

export function getDnsPropagationChecker() {
  defaultChecker ??= new NodeDnsPropagationChecker();
  return defaultChecker;
}
