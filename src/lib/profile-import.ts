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
  if (normalized === "http") return "HTTP";
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
  if (type === "ssh-profile") {
    const connType = pickString(parsed.connectionType)?.toLowerCase() ?? "";
    if (connType.includes("payload") || parsed.proxyHost) return "ssh:proxy-payload";
    if (connType.includes("ssl") || connType.includes("tls")) return "ssh:tls";
    return "ssh:direct";
  }
  if (type === "ssh") return "ssh:direct";
  if (type === "http") return "http";
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
  if (lowered.startsWith("socks://") || lowered.startsWith("socks5://") || lowered.startsWith("2socks://")) return "v2ray:socks";
  if (lowered.startsWith("ssh://")) return "ssh:direct";
  if (lowered.startsWith("wg://")) return "wireguard:profile";
  if (lowered.startsWith("http://") || lowered.startsWith("https://")) return "http";

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

  if (pickString(parsed.type)?.toLowerCase() === "ssh-profile") {
    host = pickString(parsed.server) ?? pickString(parsed.host) ?? host;
    port = pickNumber(parsed.port) ?? pickNumber(parsed.server_port) ?? port;
    label = pickString(parsed.name) ?? label;
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

export type ParsedWireGuardProfile = {
  type: "wireguard-profile";
  endpoint: { host: string; port: number };
  local_address: string[];
  private_key: string;
  peer_public_key: string;
  pre_shared_key?: string;
  allowed_ips?: string[];
  reserved?: number[];
  mtu?: number;
  dns?: string[];
  conf?: string;
};

export const isWireGuardConf = (raw: string): boolean => {
  const lowered = raw.toLowerCase();
  return (
    lowered.includes("[interface]") &&
    (lowered.includes("privatekey") || lowered.includes("[peer]") || lowered.includes("endpoint"))
  );
};

export const parseWireGuardConf = (raw: string): ParsedWireGuardProfile | null => {
  const lines = raw.split(/\r?\n/);
  let section = "";
  let privateKey = "";
  const localAddresses: string[] = [];
  const dnsServers: string[] = [];
  let mtu: number | undefined;
  let peerPublicKey = "";
  let preSharedKey = "";
  let endpointHost = "";
  let endpointPort = 51820;
  const allowedIps: string[] = [];
  const reserved: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      section = trimmed.slice(1, -1).trim().toLowerCase();
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
    const val = trimmed.slice(eqIdx + 1).trim();

    if (section === "interface") {
      if (key === "privatekey") {
        privateKey = val;
      } else if (key === "address") {
        for (const part of val.split(",")) {
          const addr = part.trim();
          if (addr) localAddresses.push(addr);
        }
      } else if (key === "dns") {
        for (const part of val.split(",")) {
          const d = part.trim();
          if (d) dnsServers.push(d);
        }
      } else if (key === "mtu") {
        const parsedMtu = parseInt(val, 10);
        if (Number.isFinite(parsedMtu) && parsedMtu > 0) mtu = parsedMtu;
      }
    } else if (section === "peer") {
      if (key === "publickey") {
        peerPublicKey = val;
      } else if (key === "presharedkey") {
        preSharedKey = val;
      } else if (key === "endpoint") {
        const lastColon = val.lastIndexOf(":");
        if (lastColon !== -1) {
          endpointHost = val.slice(0, lastColon).trim().replace(/^\[|\]$/g, "");
          const p = parseInt(val.slice(lastColon + 1).trim(), 10);
          if (Number.isFinite(p) && p > 0) endpointPort = p;
        } else {
          endpointHost = val.trim();
        }
      } else if (key === "allowedips") {
        for (const part of val.split(",")) {
          const ip = part.trim();
          if (ip) allowedIps.push(ip);
        }
      } else if (key === "reserved") {
        for (const part of val.split(",")) {
          const num = parseInt(part.trim(), 10);
          if (Number.isFinite(num)) reserved.push(num);
        }
      }
    }
  }

  if (!privateKey && !peerPublicKey && !endpointHost) return null;

  return {
    type: "wireguard-profile",
    endpoint: {
      host: endpointHost,
      port: endpointPort,
    },
    local_address: localAddresses.length > 0 ? localAddresses : ["10.0.0.2/32"],
    private_key: privateKey,
    peer_public_key: peerPublicKey,
    conf: raw.trim(),
    ...(preSharedKey ? { pre_shared_key: preSharedKey } : {}),
    ...(allowedIps.length > 0 ? { allowed_ips: allowedIps } : {}),
    ...(reserved.length > 0 ? { reserved } : {}),
    ...(mtu ? { mtu } : {}),
    ...(dnsServers.length > 0 ? { dns: dnsServers } : {}),
  };
};

export const detectProfileMetadata = (
  rawConfig: string,
  fallbackProtocol = "custom:tcp",
): ImportedProfileMetadata => {
  let trimmed = rawConfig.trim();

  try {
    if (trimmed.toLowerCase().startsWith("vless://")) {
      const url = new URL(trimmed);
      if (url.searchParams.get("type") === "ws") {
        const path = url.searchParams.get("path");
        if (path && (path.includes("?ed=2048") || path.includes("&ed=2048"))) {
          url.searchParams.set("path", "/");
          trimmed = url.toString();
        }
      }
    }
  } catch {
    // Ignore
  }

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

  if (isWireGuardConf(trimmed)) {
    const wg = parseWireGuardConf(trimmed);
    if (wg) {
      const name = buildFallbackName("wireguard:profile", wg.endpoint.host);
      return {
        rawConfig: JSON.stringify(wg, null, 2),
        protocol: "wireguard:profile",
        name,
        country: buildCountryLabel(name, wg.endpoint.host),
        host: wg.endpoint.host,
        port: wg.endpoint.port,
      };
    }
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

const KNOWN_SSH_KEYS = new Map<string, string>([
  ["protocol", "protocol"],
  ["connection type", "connectionType"],
  ["connection_type", "connectionType"],
  ["ssh server", "server"],
  ["ssh host", "server"],
  ["server", "server"],
  ["ssh port", "port"],
  ["port", "port"],
  ["username", "username"],
  ["user", "username"],
  ["password", "password"],
  ["pass", "password"],
  ["http proxy", "proxyHost"],
  ["proxy host", "proxyHost"],
  ["proxy ip", "proxyHost"],
  ["proxy port", "proxyPort"],
  ["proxy_port", "proxyPort"],
  ["proxy authentication", "proxyAuth"],
  ["proxy auth", "proxyAuth"],
  ["payload", "payload"],
  ["http payload", "payload"],
  ["sni", "sni"],
  ["server name indication", "sni"],
  ["bug host", "sni"],
  ["tls", "tls"],
  ["ssl", "tls"],
  ["udp gateway", "udpGateway"],
  ["udpgw", "udpGateway"],
  ["udp port", "udpGateway"],
  ["dns mode", "dnsMode"],
  ["dns", "dnsMode"],
  ["domain", "domain"],
  ["tunnel domain", "domain"],
  ["public key", "publicKey"],
  ["resolver", "resolver"],
  ["nameserver", "resolver"],
  ["ns", "resolver"],
]);

export const parseSshTableBlocks = (raw: string): JsonObject[] => {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const blocks: Array<{ name: string; subtitle: string; props: Record<string, string> }> = [];
  let currentBlock: { name: string; subtitle: string; props: Record<string, string> } | null = null;
  let pendingName = "";
  let pendingSubtitle = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowered = line.toLowerCase();

    let inlineKey: string | null = null;
    let inlineVal: string | null = null;

    for (const [k, field] of KNOWN_SSH_KEYS.entries()) {
      if (lowered.startsWith(k + ":") || lowered.startsWith(k + "\t") || lowered.startsWith(k + "   ")) {
        inlineKey = field;
        inlineVal = line.substring(k.length + 1).trim().replace(/^[:\t]+/, "").trim();
        break;
      }
    }

    if (inlineKey) {
      if (!currentBlock) {
        currentBlock = { name: pendingName || "SSH Server", subtitle: pendingSubtitle, props: {} };
        pendingName = "";
        pendingSubtitle = "";
      }
      currentBlock.props[inlineKey] = inlineVal || "";
      continue;
    }

    if (lowered === "setting") {
      if (i + 1 < lines.length && lines[i + 1].toLowerCase() === "value") {
        i++;
      }
      continue;
    }

    if (KNOWN_SSH_KEYS.has(lowered)) {
      const field = KNOWN_SSH_KEYS.get(lowered)!;
      let val = "";
      if (i + 1 < lines.length) {
        val = lines[i + 1];
        i++;
      }
      if (!currentBlock) {
        currentBlock = { name: pendingName || "SSH Server", subtitle: pendingSubtitle, props: {} };
        pendingName = "";
        pendingSubtitle = "";
      }
      currentBlock.props[field] = val;
      continue;
    }

    if (currentBlock && (currentBlock.props.server || currentBlock.props.protocol)) {
      blocks.push(currentBlock);
      currentBlock = null;
      pendingName = line;
      pendingSubtitle = "";
      continue;
    }

    if (!pendingName) {
      pendingName = line;
    } else if (!pendingSubtitle) {
      pendingSubtitle = line;
    } else {
      pendingName = line;
      pendingSubtitle = "";
    }
  }

  if (currentBlock && (currentBlock.props.server || currentBlock.props.protocol)) {
    blocks.push(currentBlock);
  }

  return blocks.map((b) => {
    const props = b.props;
    const server = props.server || "";
    const port = parseInt(props.port || "22", 10) || 22;
    const username = props.username || "root";
    const password = props.password || "";
    const connType = props.connectionType || (props.proxyHost ? "SSH-Proxy-Payload" : "Direct");

    const out: JsonObject = {
      type: "ssh-profile",
      name: b.name,
      protocol: "SSH",
      connectionType: connType,
      server,
      port,
      username,
      password,
    };

    if (props.proxyHost) {
      out.proxyHost = props.proxyHost;
      out.proxyPort = parseInt(props.proxyPort || "8880", 10) || 8880;
    }
    if (props.sni && props.sni.toLowerCase() !== "empty") {
      out.sni = props.sni;
    }
    if (props.tls && props.tls.toLowerCase() !== "default" && props.tls.toLowerCase() !== "disabled") {
      out.tls = true;
    }
    if (props.udpGateway) {
      out.udpGateway = parseInt(props.udpGateway, 10) || 7300;
    }
    if (props.dnsMode) {
      out.dnsMode = props.dnsMode;
    }
    if (props.domain) {
      out.domain = props.domain;
    }
    if (props.publicKey) {
      out.publicKey = props.publicKey;
    }
    return out;
  });
};

export const splitImportedProfiles = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return [trimmed];
  }

  if (isWireGuardConf(trimmed)) {
    const wg = parseWireGuardConf(trimmed);
    if (wg) {
      return [JSON.stringify(wg, null, 2)];
    }
  }

  if (
    trimmed.toLowerCase().includes("ssh server") ||
    trimmed.toLowerCase().includes("connection type") ||
    trimmed.toLowerCase().includes("ssh-proxy-payload")
  ) {
    const tableConfigs = parseSshTableBlocks(trimmed);
    if (tableConfigs.length > 0) {
      return tableConfigs.map((c) => JSON.stringify(c, null, 2));
    }
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
