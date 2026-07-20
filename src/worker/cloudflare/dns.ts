import Cloudflare from "cloudflare";

export type CloudflareZone = { id: string; name: string };
export type CloudflareVerification = {
  tokenId: string;
  status: "active" | "disabled" | "expired";
  expiresAt: number | null;
  zones: CloudflareZone[];
};

export type CloudflareDnsProvider = {
  verify(token: string): Promise<CloudflareVerification>;
  preflight(token: string, hostnames: string[]): Promise<CloudflareZone[]>;
  present(token: string, input: { orderId: string; challengeId: string; name: string; value: string; hostname: string }): Promise<{ zoneId: string; recordId: string }>;
  cleanup(token: string, zoneId: string, recordId: string): Promise<void>;
};

function client(token: string) {
  return new Cloudflare({ apiToken: token });
}

function zoneForHostname(zones: CloudflareZone[], hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  return zones
    .filter((zone) => normalized === zone.name || normalized.endsWith(`.${zone.name}`))
    .sort((left, right) => right.name.length - left.name.length)[0];
}

async function visibleZones(api: Cloudflare) {
  const zones: CloudflareZone[] = [];
  for await (const zone of api.zones.list({ status: "active", per_page: 50 })) {
    if (zone.id && zone.name) zones.push({ id: zone.id, name: zone.name.toLowerCase() });
  }
  return zones;
}

export class NodeCloudflareDnsProvider implements CloudflareDnsProvider {
  async verify(token: string) {
    const api = client(token);
    const [verification, zones] = await Promise.all([api.user.tokens.verify(), visibleZones(api)]);
    return {
      tokenId: verification.id,
      status: verification.status,
      expiresAt: verification.expires_on ? Date.parse(verification.expires_on) : null,
      zones,
    };
  }

  async preflight(token: string, hostnames: string[]) {
    const verification = await this.verify(token);
    if (verification.status !== "active") throw new Error(`Cloudflare API token status is ${verification.status}`);
    const zones = hostnames.map((hostname) => {
      const zone = zoneForHostname(verification.zones, hostname);
      if (!zone) throw new Error(`Cloudflare token cannot access the zone for ${hostname}`);
      return zone;
    });
    for (const zone of new Map(zones.map((item) => [item.id, item])).values()) {
      const records = client(token).dns.records.list({ zone_id: zone.id, type: "TXT", per_page: 1 });
      await records[Symbol.asyncIterator]().next();
    }
    return zones;
  }

  async present(token: string, input: { orderId: string; challengeId: string; name: string; value: string; hostname: string }) {
    const api = client(token);
    const [zone] = await this.preflight(token, [input.hostname]);
    if (!zone) throw new Error(`Cloudflare zone unavailable: ${input.hostname}`);
    const comment = `nginx-domain-manager:${input.orderId}:${input.challengeId}`;
    for await (const record of api.dns.records.list({
      zone_id: zone.id,
      type: "TXT",
      name: { exact: input.name },
      content: { exact: input.value },
      comment: { exact: comment },
      match: "all",
      per_page: 1,
    })) {
      if (record.id) return { zoneId: zone.id, recordId: record.id };
    }
    const record = await api.dns.records.create({
      zone_id: zone.id,
      type: "TXT",
      name: input.name,
      content: input.value,
      ttl: 1,
      proxied: false,
      comment,
    });
    if (!record.id) throw new Error("Cloudflare did not return a DNS record ID");
    return { zoneId: zone.id, recordId: record.id };
  }

  async cleanup(token: string, zoneId: string, recordId: string) {
    try {
      await client(token).dns.records.delete(recordId, { zone_id: zoneId });
    } catch (error) {
      if (typeof error === "object" && error && "status" in error && error.status === 404) return;
      throw error;
    }
  }
}

let provider: CloudflareDnsProvider | null = null;

export function getCloudflareDnsProvider() {
  provider ??= new NodeCloudflareDnsProvider();
  return provider;
}

export function setCloudflareDnsProvider(next: CloudflareDnsProvider | null) {
  provider = next;
}
