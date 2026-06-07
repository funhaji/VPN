type JsonObject = Record<string, unknown>;

export type ImportedProfileMetadata = {
  rawConfig: string;
  protocol: string;
  name: string;
  country: string;
  host?: string;
  port?: number;
};

const SHARE_PREFIXES = [
  "vless://",
  "vmess://",
  "trojan://",
  "ss://",
  "hy2://",
  "hysteria2://",
  "ssh://",
  "wg://",
];

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const pickString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const pickNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
};

const decodeBase64 = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));

  if (typeof atob === "function") {
    return atob(normalized + padding);
  }

  return Buffer.from(normalized + padding, "base64").toString("utf8");
};

const decodeHashLabel = (hash: string): string | undefined => {
  const value = hash.replace(/^#/, "").trim();
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const prettifyProtocol = (protocol: string): string => {
  const normalized = protocol.trim().toLowerCase();
  if (normalized.includes("vless")) return "VLESS";
  if (normalized.includes("vmess")) return "VMess";
  if (normalized.includes("trojan")) return "Trojan";
  if (normalized.includes("shadowsocks") || normalized === "ss") return "Shadowsocks";
  if (normalized.includes("hysteria2") || normalized.includes("hy2")) return "Hysteria2";
  if (normalized.includes("wireguard") || normalized === "wg") return "WireGuard";
  if (normalized.includes("openvpn")) return "OpenVPN";
  if (normalized.includes("ssh")) return "SSH";
  return "Imported";
};

const buildFallbackName = (protocol: string, host?: string, label?: string): string =>
  label || (host ? `${prettifyProtocol(protocol)} ${host}` : `${prettifyProtocol(protocol)} profile`);

const buildCountryLabel = (name: string, host?: string): string => {
  const preferred = name.trim() || host?.trim() || "Imported";
  return preferred.length >= 2 ? preferred : "Imported";
};

const normalizeUriScheme = (raw: string): string => raw.replace(/^hy2:\/\//i, "hysteria2://");

const detectProtocolFromParsed = (parsed: JsonObject): string | undefined => {
  const type = pickString(parsed.type)?.toLowerCase();
  if (type === "wireguard-profile") return "wireguard:profile";
  if (type === "openvpn-profile") {
    return `openvpn:${pickString(parsed.transport)?.toLowerCase() ?? "udp"}`;
  }
  if (type === "dnstt-ssh") return "ssh:dnstt";
  if (type === "ssh") return "ssh:direct";
  if (type && ["vless", "vmess", "trojan", "shadowsocks", "hysteria2"].includes(type)) {
    return `v2ray:${type}`;
  }

  const outbounds = Array.isArray(parsed.outbounds) ? parsed.outbounds : [];
  const outbound = outbounds.find((entry) => isObject(entry));
  if (!isObject(outbound)) return undefined;

  const outboundType = pickString(outbound.type)?.toLowerCase();
  if (outboundType && ["vless", "vmess", "trojan", "shadowsocks", "hysteria2", "ssh", "wireguard"].includes(outboundType)) {
    if (outboundType === "wireguard") return "wireguard:profile";
    if (outboundType === "ssh") return "ssh:direct";
    return `v2ray:${outboundType}`;
  }

  const outboundProtocol = pickString(outbound.protocol)?.toLowerCase();
  if (outboundProtocol && ["vless", "vmess", "trojan", "shadowsocks"].includes(outboundProtocol)) {
    return `v2ray:${outboundProtocol}`;
  }

  return undefined;
};

export const detectProtocol = (rawConfig: string, fallback = "custom:tcp"): string => {
  const trimmed = rawConfig.trim();
  const lowered = trimmed.toLowerCase();

  if (lowered.startsWith("vless://")) return "v2ray:vless";
  if (lowered.startsWith("vmess://")) return "v2ray:vmess";
  if (lowered.startsWith("trojan://")) return "v2ray:trojan";
  if (lowered.startsWith("ss://")) return "v2ray:shadowsocks";
  if (lowered.startsWith("hy2://") || lowered.startsWith("hysteria2://")) return "v2ray:hysteria2";
  if (lowered.startsWith("ssh://")) return "ssh:direct";
  if (lowered.startsWith("wg://")) return "wireguard:profile";

  const parsed = parseJson(trimmed);
  if (isObject(parsed)) {
    return detectProtocolFromParsed(parsed) ?? fallback.toLowerCase();
  }

  return fallback.toLowerCase();
};

const detectEndpointFromUrl = (
  rawConfig: string,
): { host?: string; port?: number; name?: string } => {
  try {
    const url = new URL(normalizeUriScheme(rawConfig));
    return {
      host: url.hostname || undefined,
      port: pickNumber(url.port),
      name: decodeHashLabel(url.hash),
    };
  } catch {
    return {};
  }
};

const detectFromVmess = (rawConfig: string): ImportedProfileMetadata | null => {
  try {
    const payload = rawConfig.replace(/^vmess:\/\//i, "").trim();
    const decoded = decodeBase64(payload);
    const parsed = parseJson(decoded);
    if (!isObject(parsed)) return null;

    const host = pickString(parsed.add);
    const port = pickNumber(parsed.port);
    const label =
      pickString(parsed.ps) ??
      pickString(parsed.name) ??
      pickString(parsed.tag);
    const name = buildFallbackName("v2ray:vmess", host, label);

    return {
      rawConfig: rawConfig.trim(),
      protocol: "v2ray:vmess",
      name,
      country: buildCountryLabel(name, host),
      host,
      port,
    };
  } catch {
    return null;
  }
};

const detectFromJson = (rawConfig: string, fallbackProtocol: string): ImportedProfileMetadata | null => {
  const parsed = parseJson(rawConfig);
  if (!isObject(parsed)) return null;

  const detectedProtocol = detectProtocolFromParsed(parsed) ?? fallbackProtocol;
  let host =
    pickString(parsed.host) ??
    pickString(parsed.server);
  let port =
    pickNumber(parsed.port) ??
    pickNumber(parsed.server_port);
  let label =
    pickString(parsed.name) ??
    pickString(parsed.tag) ??
    pickString(parsed.remarks) ??
    pickString(parsed.ps);

  if (pickString(parsed.type)?.toLowerCase() === "wireguard-profile" && isObject(parsed.endpoint)) {
    host = pickString(parsed.endpoint.host) ?? host;
    port = pickNumber(parsed.endpoint.port) ?? port;
  }

  if (pickString(parsed.type)?.toLowerCase() === "openvpn-profile" && isObject(parsed.remote)) {
    host = pickString(parsed.remote.host) ?? host;
    port = pickNumber(parsed.remote.port) ?? port;
  }

  if (pickString(parsed.type)?.toLowerCase() === "dnstt-ssh") {
    const ssh = isObject(parsed.ssh) ? parsed.ssh : {};
    const tunnel = isObject(parsed.tunnel) ? parsed.tunnel : {};
    host = pickString(ssh.host) ?? pickString(tunnel.domain) ?? host;
    port = pickNumber(ssh.port) ?? port;
    label = pickString(tunnel.domain) ?? pickString(ssh.host) ?? label;
  }

  const outbounds = Array.isArray(parsed.outbounds) ? parsed.outbounds : [];
  const outbound = outbounds.find((entry) => isObject(entry));
  if (isObject(outbound)) {
    host =
      pickString(outbound.server) ??
      pickString(outbound.address) ??
      host;
    port =
      pickNumber(outbound.server_port) ??
      pickNumber(outbound.port) ??
      port;
    label =
      pickString(outbound.tag) ??
      label;

    const settings = isObject(outbound.settings) ? outbound.settings : {};
    const vnext = Array.isArray(settings.vnext) ? settings.vnext[0] : null;
    const servers = Array.isArray(settings.servers) ? settings.servers[0] : null;
    if (isObject(vnext)) {
      host = pickString(vnext.address) ?? host;
      port = pickNumber(vnext.port) ?? port;
    }
    if (isObject(servers)) {
      host = pickString(servers.address) ?? host;
      port = pickNumber(servers.port) ?? port;
    }
  }

  const name = buildFallbackName(detectedProtocol, host, label);
  return {
    rawConfig: rawConfig.trim(),
    protocol: detectedProtocol,
    name,
    country: buildCountryLabel(name, host),
    host,
    port,
  };
};

export const detectProfileMetadata = (
  rawConfig: string,
  fallbackProtocol = "custom:tcp",
): ImportedProfileMetadata => {
  const trimmed = rawConfig.trim();
  const lowered = trimmed.toLowerCase();

  if (lowered.startsWith("vmess://")) {
    return detectFromVmess(trimmed) ?? {
      rawConfig: trimmed,
      protocol: "v2ray:vmess",
      name: buildFallbackName("v2ray:vmess"),
      country: "Imported",
    };
  }

  const parsedJson = detectFromJson(trimmed, fallbackProtocol.toLowerCase());
  if (parsedJson) {
    return parsedJson;
  }

  const detectedProtocol = detectProtocol(trimmed, fallbackProtocol);
  const endpoint = detectEndpointFromUrl(trimmed);
  const name = buildFallbackName(detectedProtocol, endpoint.host, endpoint.name);

  return {
    rawConfig: trimmed,
    protocol: detectedProtocol,
    name,
    country: buildCountryLabel(name, endpoint.host),
    host: endpoint.host,
    port: endpoint.port,
  };
};

export const splitImportedProfiles = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return [trimmed];
  }

  return trimmed
    .split(/\r?\n+/)
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry) return false;
      if (entry.startsWith("//") || entry.startsWith("# ")) return false;
      const lowered = entry.toLowerCase();
      return SHARE_PREFIXES.some((prefix) => lowered.startsWith(prefix));
    });
};
