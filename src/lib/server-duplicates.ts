import { createHash } from "node:crypto";

export type DuplicateCandidate = {
  id?: string; name: string; protocol: string; host?: string; port?: number; rawConfig: string;
};
export type DuplicateMatch = { incoming: string; existing: string; kind: "duplicate" | "shared-endpoint" | "shared-host" | "shared-credential" };

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value;
export function normalizeHost(value: string): string {
  const host = value.trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  try { return new URL(`http://${host.includes(":") ? `[${host}]` : host}`).hostname.replace(/^\[|\]$/g, ""); }
  catch { return host; }
}

export function serverIdentity(candidate: DuplicateCandidate) {
  let config = candidate.rawConfig.trim().replace(/\r\n/g, "\n");
  let host = candidate.host ?? "";
  let port = candidate.port ?? 0;
  let credential = "";
  const scheme = config.match(/^([a-z0-9+.-]+):\/\//i)?.[1]?.toLowerCase();
  try {
    if (scheme === "vmess") {
      const parsed = JSON.parse(Buffer.from(config.slice(8).split("#")[0], "base64").toString("utf8"));
      host = String(parsed.add ?? host); port = Number(parsed.port ?? port); credential = String(parsed.id ?? "").toLowerCase();
      delete parsed.ps;
      parsed.add = normalizeHost(host); parsed.port = port; parsed.id = credential;
      config = JSON.stringify(stable(parsed));
    } else if (scheme) {
      const url = new URL(config);
      host = url.hostname || host; port = Number(url.port || port);
      credential = decodeURIComponent(url.username);
      if (/^(vless|vmess)$/.test(scheme)) { credential = credential.toLowerCase(); url.username = credential; }
      url.hash = "";
      url.hostname = normalizeHost(host).includes(":") ? `[${normalizeHost(host)}]` : normalizeHost(host);
      url.searchParams.sort();
      config = url.toString();
    } else if (config.startsWith("{") || config.startsWith("[")) {
      const parsed = JSON.parse(config);
      const visit = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        for (const [key, item] of Object.entries(value)) {
          if (!credential && /^(uuid|private_key|privateKey|password)$/i.test(key) && typeof item === "string") credential = item;
          if (/^(server|address|host)$/i.test(key) && typeof item === "string" && !host) host = item;
          visit(item);
        }
      };
      visit(parsed);
      config = JSON.stringify(stable(parsed));
    } else {
      const endpoint = config.match(/^\s*Endpoint\s*=\s*(\[[^\]]+\]|[^:\s]+):(\d+)/im);
      if (endpoint) { host = endpoint[1]; port = Number(endpoint[2]); }
      credential = config.match(/^\s*PrivateKey\s*=\s*(\S+)/im)?.[1] ?? "";
      // Ignore comments, preserve directive order (significant for OpenVPN).
      config = config.split("\n").filter(line => !/^\s*[#;]/.test(line)).map(line => line.trim()).filter(Boolean).join("\n");
    }
  } catch { /* Unrecognized formats still get exact-config duplicate detection. */ }
  const endpoint = host && host !== "embedded-config" ? `${normalizeHost(host)}:${port}` : "";
  return { exact: digest(config), endpoint, host: endpoint ? normalizeHost(host) : "", credential: credential ? digest(credential) : "" };
}

export function findServerDuplicates(incoming: DuplicateCandidate[], existing: DuplicateCandidate[]): DuplicateMatch[] {
  const indexed = existing.map(server => ({ server, identity: serverIdentity(server) }));
  const matches: DuplicateMatch[] = [];
  for (const server of incoming) {
    const identity = serverIdentity(server);
    for (const other of indexed) {
      if (server.id && server.id === other.server.id) continue;
      if (identity.exact === other.identity.exact) {
        matches.push({ incoming: server.name, existing: other.server.name, kind: "duplicate" });
        continue;
      }
      const endpointKind = identity.endpoint && identity.endpoint === other.identity.endpoint ? "shared-endpoint"
        : identity.host && identity.host === other.identity.host ? "shared-host" : null;
      if (endpointKind) matches.push({ incoming: server.name, existing: other.server.name, kind: endpointKind });
      if (identity.credential && identity.credential === other.identity.credential) matches.push({ incoming: server.name, existing: other.server.name, kind: "shared-credential" });
    }
    indexed.push({ server, identity });
  }
  return matches;
}
