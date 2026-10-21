import { NextRequest, NextResponse } from "next/server";
import { decryptConfig } from "@/lib/crypto";
import { listServers } from "@/lib/db";
import { parseWireGuardConf } from "@/lib/profile-import";
import type { ProtocolOptions, ServerRecord } from "@/types/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const parseNumber = (value: string | null | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBoolean = (value: string | null | undefined): boolean | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
};

const splitCsv = (value: string | null | undefined): string[] | undefined => {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
};

const decodeBase64 = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
};

const pickString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const pickNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
};

const withOptional = <T extends JsonObject>(
  base: T,
  entries: Record<string, unknown>,
): T => {
  const output: JsonObject = { ...base };
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isObject(value) && Object.keys(value).length === 0) continue;
    output[key] = value;
  }
  return output as T;
};

const buildMultiplex = (options: ProtocolOptions): JsonObject | undefined =>
  options.mux ? { enabled: true } : undefined;

const parseExtraJson = (value: string | null | undefined): JsonObject | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const candidate = trimmed.startsWith("{") ? trimmed : decodeBase64(trimmed);
  const parsed = parseJson(candidate);
  return isObject(parsed) ? parsed : undefined;
};

const buildXhttpTransport = (params: {
  path?: string | null;
  host?: string | null;
  mode?: string | null;
  extra?: string | null;
  headers?: Record<string, string>;
}): JsonObject =>
  withOptional(
    { type: "xhttp" },
    {
      path: params.path ?? undefined,
      host: params.host ?? undefined,
      mode: params.mode ?? undefined,
      extra: parseExtraJson(params.extra),
      headers: params.headers,
    },
  );

const buildTlsFromUrl = (
  url: URL,
  options: ProtocolOptions,
  defaults?: { enabled?: boolean; reality?: boolean },
): JsonObject | undefined => {
  const security = url.searchParams.get("security")?.toLowerCase();
  const insecure =
    parseBoolean(url.searchParams.get("allowInsecure")) ??
    parseBoolean(url.searchParams.get("insecure")) ??
    options.allowInsecure;
  const serverName =
    url.searchParams.get("sni") ??
    url.searchParams.get("peer") ??
    undefined;
  const alpn = splitCsv(url.searchParams.get("alpn"));
  const fingerprint = url.searchParams.get("fp") ?? url.searchParams.get("fingerprint") ?? undefined;
  const pcs =
    url.searchParams.get("pcs") ??
    url.searchParams.get("pinnedPeerCertSha256") ??
    url.searchParams.get("pinSHA256") ??
    undefined;
  const isReality = defaults?.reality || security === "reality";
  const enabled =
    defaults?.enabled ??
    (isReality ||
      security === "tls" ||
      Boolean(serverName) ||
      Boolean(pcs) ||
      Boolean(alpn && alpn.length > 0));

  if (!enabled) return undefined;

  return withOptional(
    {
      enabled: true,
      insecure,
    },
    {
      server_name: serverName,
      alpn,
      pinned_peer_cert_sha256: pcs,
      utls: fingerprint ? { enabled: true, fingerprint } : undefined,
      reality: isReality
        ? {
            enabled: true,
            public_key: url.searchParams.get("pbk") ?? undefined,
            short_id: url.searchParams.get("sid") ?? undefined,
          }
        : undefined,
    },
  );
};

const buildTransportFromUrl = (url: URL): JsonObject | undefined => {
  const type = (url.searchParams.get("type") ?? "tcp").toLowerCase();
  if (type === "tcp") {
    const headerType = (url.searchParams.get("headerType") ?? "").toLowerCase();
    if (headerType === "http") {
      return withOptional(
        { type: "http" },
        {
          path: url.searchParams.get("path") ?? undefined,
          host: splitCsv(url.searchParams.get("host")),
          method: url.searchParams.get("method") ?? undefined,
        },
      );
    }
    return undefined;
  }
  if (type === "ws") {
    const rawPath = url.searchParams.get("path") ?? "";
    let wsPath: string | undefined;
    let ed: number;
    const embeddedQ = rawPath.indexOf("?");
    if (embeddedQ !== -1) {
      const pathPart = rawPath.slice(0, embeddedQ);
      const embedded = new URLSearchParams(rawPath.slice(embeddedQ + 1));
      const edFromPath = parseNumber(embedded.get("ed"), 0);
      ed = edFromPath > 0 ? edFromPath : parseNumber(url.searchParams.get("ed"), 0);
      wsPath = pathPart || "/";
    } else {
      wsPath = rawPath || undefined;
      ed = parseNumber(url.searchParams.get("ed"), 0);
    }
    return withOptional(
      { type: "ws" },
      {
        path: wsPath,
        headers: url.searchParams.get("host")
          ? { Host: url.searchParams.get("host") }
          : undefined,
        max_early_data: ed > 0 ? ed : undefined,
        early_data_header_name:
          ed > 0 ? (url.searchParams.get("eh") ?? "Sec-WebSocket-Protocol") : undefined,
      },
    );
  }
  if (type === "grpc") {
    return withOptional(
      { type: "grpc" },
      {
        service_name:
          url.searchParams.get("serviceName") ??
          url.searchParams.get("service_name") ??
          undefined,
      },
    );
  }
  if (type === "http" || type === "h2") {
    return withOptional(
      { type: "http" },
      {
        path: url.searchParams.get("path") ?? undefined,
        host: splitCsv(url.searchParams.get("host")),
      },
    );
  }
  if (type === "httpupgrade") {
    return withOptional(
      { type: "httpupgrade" },
      {
        path: url.searchParams.get("path") ?? undefined,
        host: url.searchParams.get("host") ?? undefined,
      },
    );
  }
  if (type === "xhttp" || type === "splithttp") {
    return buildXhttpTransport({
      path: url.searchParams.get("path"),
      host: url.searchParams.get("host"),
      mode: url.searchParams.get("mode"),
      extra: url.searchParams.get("extra"),
      headers: undefined, // Don't add Host header - Xray rejects it in xhttp
    });
  }
  return undefined;
};

const normalizeProtocol = (protocol: string, rawConfig: string): string => {
  const lowered = protocol.trim().toLowerCase();
  const trimmed = rawConfig.trim().toLowerCase();

  if (trimmed.startsWith("vless://")) return "vless";
  if (trimmed.startsWith("vmess://")) return "vmess";
  if (trimmed.startsWith("trojan://")) return "trojan";
  if (trimmed.startsWith("ss://")) return "shadowsocks";
  if (trimmed.startsWith("hy2://") || trimmed.startsWith("hysteria2://")) return "hysteria2";
  if (trimmed.startsWith("socks://") || trimmed.startsWith("socks5://") || trimmed.startsWith("2socks://")) return "socks";
  if (trimmed.startsWith("ssh://")) return "ssh";
  if (trimmed.startsWith("wg://")) return "wireguard";
  if (lowered.includes("vless")) return "vless";
  if (lowered.includes("vmess")) return "vmess";
  if (lowered.includes("trojan")) return "trojan";
  if (lowered.includes("shadowsocks") || lowered.endsWith(":ss") || lowered === "ss") return "shadowsocks";
  if (lowered.includes("hysteria2") || lowered.includes("hy2")) return "hysteria2";
  if (lowered.includes("socks")) return "socks";
  if (lowered.includes("ssh")) return "ssh";
  if (lowered.includes("wireguard") || lowered === "wg") return "wireguard";
  if (lowered.includes("warp") || lowered === "warp") return "warp";
  if (lowered.includes("openvpn")) return "openvpn";
  return lowered;
};

const buildOutboundFromVless = (
  rawConfig: string,
  options: ProtocolOptions,
): JsonObject => {
  const url = new URL(rawConfig);
  const encryption =
    url.searchParams.get("encryption") ??
    url.searchParams.get("enc") ??
    url.searchParams.get("encrypt") ??
    undefined;
  return withOptional(
    {
      type: "vless",
      tag: "proxy",
      server: url.hostname,
      server_port: parseNumber(url.port, 443),
      uuid: decodeURIComponent(url.username),
    },
    {
      encryption,
      flow: url.searchParams.get("flow") ?? undefined,
      packet_encoding:
        pickString(options.extra.packetEncoding) ??
        pickString(options.extra.packet_encoding) ??
        pickString(url.searchParams.get("packetEncoding")) ??
        undefined,
      tls: buildTlsFromUrl(url, options, {
        reality: (url.searchParams.get("security") ?? "").toLowerCase() === "reality",
      }),
      transport: buildTransportFromUrl(url),
      multiplex: buildMultiplex(options),
    },
  );
};

const buildOutboundFromTrojan = (
  rawConfig: string,
  options: ProtocolOptions,
): JsonObject => {
  const url = new URL(rawConfig);
  return withOptional(
    {
      type: "trojan",
      tag: "proxy",
      server: url.hostname,
      server_port: parseNumber(url.port, 443),
      password: decodeURIComponent(url.username),
    },
    {
      tls: buildTlsFromUrl(url, options, { enabled: (url.searchParams.get("security") ?? "tls") !== "none" }),
      transport: buildTransportFromUrl(url),
      multiplex: buildMultiplex(options),
    },
  );
};

const buildOutboundFromShadowsocks = (
  rawConfig: string,
  options: ProtocolOptions,
): JsonObject => {
  const withoutHash = rawConfig.split("#", 1)[0];
  const url = new URL(withoutHash);
  let method = decodeURIComponent(url.username);
  let password = decodeURIComponent(url.password);

  if (!password) {
    const decoded = decodeBase64(method);
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex > 0) {
      method = decoded.slice(0, separatorIndex);
      password = decoded.slice(separatorIndex + 1);
    }
  }

  return withOptional(
    {
      type: "shadowsocks",
      tag: "proxy",
      server: url.hostname,
      server_port: parseNumber(url.port, 443),
      method,
      password,
    },
    {
      plugin: url.searchParams.get("plugin") ?? undefined,
      multiplex: buildMultiplex(options),
    },
  );
};

const buildOutboundFromHysteria2 = (
  rawConfig: string,
  options: ProtocolOptions,
): JsonObject => {
  const url = new URL(rawConfig.replace(/^hy2:\/\//i, "hysteria2://"));
  return withOptional(
    {
      type: "hysteria2",
      tag: "proxy",
      server: url.hostname,
      server_port: parseNumber(url.port, 443),
      password: decodeURIComponent(url.username || url.password),
      tls: buildTlsFromUrl(url, options, { enabled: true }),
    },
    {
      up_mbps: pickNumber(options.extra.upMbps) ?? pickNumber(options.extra.up_mbps),
      down_mbps: pickNumber(options.extra.downMbps) ?? pickNumber(options.extra.down_mbps),
      obfs: url.searchParams.get("obfs-password")
        ? {
            type: url.searchParams.get("obfs") ?? "salamander",
            password: url.searchParams.get("obfs-password"),
          }
        : undefined,
    },
  );
};

const buildOutboundFromSocks = (
  rawConfig: string,
  options: ProtocolOptions,
): JsonObject => {
  const url = new URL(rawConfig.replace(/^2?socks5?:\/\//i, "socks5://"));
  let username = decodeURIComponent(url.username);
  let password = decodeURIComponent(url.password);

  if (!password && username) {
    try {
      const decoded = atob(username);
      if (decoded.includes(":")) {
        const parts = decoded.split(":");
        username = parts[0];
        password = parts.slice(1).join(":");
      }
    } catch (e) {
      // Not base64
    }
  }

  return withOptional(
    {
      type: "socks",
      tag: "proxy",
      server: url.hostname,
      server_port: parseNumber(url.port, 1080),
    },
    {
      username: username || undefined,
      password: password || undefined,
    }
  );
};

const buildOutboundFromHttpUri = (
  rawConfig: string,
): JsonObject => {
  const url = new URL(rawConfig);
  return withOptional(
    {
      type: "http",
      tag: "proxy",
      server: url.hostname,
      server_port: parseNumber(url.port, 8080),
    },
    {
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
    },
  );
};

const buildOutboundFromSsh = (
  rawConfig: string,
): JsonObject => {
  const parsed = parseJson(rawConfig);
  if (isObject(parsed)) {
    const pType = pickString(parsed.type)?.toLowerCase();
    if (pType === "ssh-profile" || pType === "ssh" || (!pType && (parsed.server || parsed.host))) {
    const server = pickString(parsed.server) ?? pickString(parsed.host) ?? "";
    const port = pickNumber(parsed.port) ?? pickNumber(parsed.server_port) ?? 22;
    const user = pickString(parsed.username) ?? pickString(parsed.user) ?? "root";
    const password = pickString(parsed.password) ?? pickString(parsed.pass);
    const proxyHost = pickString(parsed.proxyHost) ?? pickString(parsed.httpProxy);
    const proxyPort = pickNumber(parsed.proxyPort) ?? 8880;
    const sni = pickString(parsed.sni);
    const isTls = Boolean(parsed.tls);

    const baseOutbound: JsonObject = {
      type: "ssh",
      tag: "proxy",
      server,
      server_port: port,
      user,
    };
    if (password) {
      baseOutbound.password = password;
    }

    if (proxyHost) {
      baseOutbound.detour = "http-proxy";
      const extraOutbounds: JsonObject[] = [
        withOptional(
          {
            type: "http",
            tag: "http-proxy",
            server: proxyHost,
            server_port: proxyPort,
          },
          {
            tls: isTls
              ? withOptional(
                  { enabled: true },
                  { server_name: sni && sni.toLowerCase() !== "empty" ? sni : undefined },
                )
              : undefined,
            headers: {
              Host: `${server}:${port}`,
            },
          },
        ),
      ];
      baseOutbound._extra_outbounds = extraOutbounds;
    }

    baseOutbound._ssh_profile = parsed;
    return baseOutbound;
  }
}

  const url = new URL(rawConfig);
  return withOptional(
    {
      type: "ssh",
      tag: "proxy",
      server: url.hostname,
      server_port: parseNumber(url.port, 22),
    },
    {
      user: decodeURIComponent(url.username || "root"),
      password: url.password ? decodeURIComponent(url.password) : undefined,
    },
  );
};

const buildOutboundFromWireguardProfile = (rawConfig: string): JsonObject => {
  let candidate: JsonObject | null = null;
  const parsedJson = parseJson(rawConfig);
  if (isObject(parsedJson) && isObject(parsedJson.endpoint)) {
    candidate = parsedJson;
  } else {
    const parsedConf = parseWireGuardConf(rawConfig);
    if (parsedConf) {
      candidate = parsedConf as unknown as JsonObject;
    }
  }

  if (!candidate || !isObject(candidate.endpoint)) {
    throw new Error("Invalid WireGuard profile");
  }

  const endpoint = candidate.endpoint;
  const localAddress = Array.isArray(candidate.local_address)
    ? candidate.local_address.filter((item): item is string => typeof item === "string")
    : [];
  const allowedIps = Array.isArray(candidate.allowed_ips)
    ? candidate.allowed_ips.filter((item): item is string => typeof item === "string")
    : undefined;
  const dnsServers = Array.isArray(candidate.dns)
    ? candidate.dns.filter((item): item is string => typeof item === "string")
    : typeof candidate.dns === "string" ? [candidate.dns] : undefined;
  const reserved = Array.isArray(candidate.reserved)
    ? candidate.reserved.filter((item): item is number => typeof item === "number")
    : undefined;

  return withOptional(
    {
      type: "wireguard",
      tag: "proxy",
      server: pickString(endpoint.host) ?? "",
      server_port: pickNumber(endpoint.port) ?? 51820,
      local_address: localAddress,
      private_key: pickString(candidate.private_key) ?? "",
      peer_public_key: pickString(candidate.peer_public_key) ?? "",
    },
    {
      conf: pickString(candidate.conf),
      pre_shared_key: pickString(candidate.pre_shared_key),
      allowed_ips: allowedIps,
      dns: dnsServers,
      reserved,
      mtu: pickNumber(candidate.mtu),
    },
  );
};

const unwrapOpenVpnProfileContent = (profile: string): string => {
  const trimmed = profile.trim();
  const parsed = parseJson(trimmed);
  if (!isObject(parsed) || pickString(parsed.type)?.toLowerCase() !== "openvpn-profile") {
    return trimmed;
  }
  const nested = pickString(parsed.profile);
  return nested ? unwrapOpenVpnProfileContent(nested) : trimmed;
};

const buildOpenVpnRuntimeProfile = (rawConfig: string): JsonObject => {
  const parsed = parseJson(rawConfig);
  if (!isObject(parsed) || !isObject(parsed.remote)) {
    throw new Error("Invalid OpenVPN profile");
  }
  const remote = parsed.remote;
  const credentials = isObject(parsed.credentials) ? parsed.credentials : {};
  const profile = unwrapOpenVpnProfileContent(pickString(parsed.profile) ?? "");
  if (!profile.trim()) {
    throw new Error("Invalid OpenVPN profile");
  }
  return {
    engine: "openvpn",
    supported: true,
    outbound: withOptional(
      {
        type: "openvpn-profile",
        host: pickString(remote.host) ?? "",
        port: pickNumber(remote.port) ?? 1194,
        transport: pickString(parsed.transport) ?? "udp",
        profile,
      },
      {
        credentials:
          pickString(credentials.username) || pickString(credentials.password)
            ? {
                username: pickString(credentials.username) ?? "",
                password: pickString(credentials.password) ?? "",
              }
            : undefined,
      },
    ),
  };
};

const buildOutboundFromVmess = (
  rawConfig: string,
  options: ProtocolOptions,
): JsonObject => {
  const encoded = rawConfig.replace(/^vmess:\/\//i, "").trim();
  const decoded = decodeBase64(encoded);
  const parsed = parseJson(decoded);
  if (!isObject(parsed)) {
    throw new Error("Invalid VMess config");
  }

  const network = pickString(parsed.net) ?? "tcp";
  const tlsMode = pickString(parsed.tls);
  const serverName = pickString(parsed.sni);
  const host = pickString(parsed.host);
  const path = pickString(parsed.path);
  const serviceName = pickString(parsed.path) ?? pickString(parsed.serviceName);
  const transport =
    network === "ws"
      ? withOptional(
          { type: "ws" },
          {
            path,
            headers: host ? { Host: host } : undefined,
          },
        )
      : network === "grpc"
        ? withOptional(
            { type: "grpc" },
            {
              service_name: serviceName,
            },
          )
        : network === "http" || network === "h2"
          ? withOptional(
              { type: "http" },
              {
                path,
                host: host ? [host] : undefined,
              },
            )
          : network === "xhttp" || network === "splithttp"
            ? buildXhttpTransport({ path, host })
            : undefined;

  return withOptional(
    {
      type: "vmess",
      tag: "proxy",
      server: pickString(parsed.add) ?? "",
      server_port: pickNumber(parsed.port) ?? 443,
      uuid: pickString(parsed.id) ?? "",
    },
    {
      security: pickString(parsed.scy) ?? "auto",
      alter_id: pickNumber(parsed.aid) ?? 0,
      packet_encoding:
        pickString(options.extra.packetEncoding) ??
        pickString(options.extra.packet_encoding) ??
        undefined,
      tls:
        tlsMode && tlsMode !== "none"
          ? withOptional(
              {
                enabled: true,
                insecure: options.allowInsecure,
              },
              {
                server_name: serverName,
                utls: pickString(parsed.fp)
                  ? { enabled: true, fingerprint: pickString(parsed.fp) }
                  : undefined,
                alpn: splitCsv(pickString(parsed.alpn)),
              },
            )
          : undefined,
      transport,
      multiplex: buildMultiplex(options),
    },
  );
};

const buildOutboundFromXrayJson = (
  json: JsonObject,
  options: ProtocolOptions,
): JsonObject | null => {
  const outbounds = Array.isArray(json.outbounds) ? json.outbounds : [];
  const outbound = outbounds.find((entry) => {
    if (!isObject(entry)) return false;
    const protocol = pickString(entry.protocol);
    return Boolean(protocol && !["direct", "freedom", "blackhole", "dns"].includes(protocol));
  });

  if (!isObject(outbound)) {
    return null;
  }

  const protocol = pickString(outbound.protocol)?.toLowerCase();
  const settings = isObject(outbound.settings) ? outbound.settings : {};
  const streamSettings = isObject(outbound.streamSettings) ? outbound.streamSettings : {};
  const network = pickString(streamSettings.network);
  const security = pickString(streamSettings.security)?.toLowerCase();
  const tlsSettings = isObject(streamSettings.tlsSettings) ? streamSettings.tlsSettings : {};
  const realitySettings = isObject(streamSettings.realitySettings) ? streamSettings.realitySettings : {};
  const wsSettings = isObject(streamSettings.wsSettings) ? streamSettings.wsSettings : {};
  const grpcSettings = isObject(streamSettings.grpcSettings) ? streamSettings.grpcSettings : {};
  const httpSettings = isObject(streamSettings.httpSettings) ? streamSettings.httpSettings : {};
  const httpupgradeSettings = isObject(streamSettings.httpupgradeSettings)
    ? streamSettings.httpupgradeSettings
    : {};
  const xhttpSettings = isObject(streamSettings.xhttpSettings)
    ? streamSettings.xhttpSettings
    : isObject(streamSettings.splithttpSettings)
      ? streamSettings.splithttpSettings
      : {};

  const tls = security === "tls" || security === "reality"
    ? withOptional(
        {
          enabled: true,
          insecure: options.allowInsecure,
        },
        {
          server_name:
            pickString(tlsSettings.serverName) ??
            pickString(realitySettings.serverName) ??
            undefined,
          alpn: Array.isArray(tlsSettings.alpn)
            ? tlsSettings.alpn.filter((item): item is string => typeof item === "string")
            : undefined,
          utls: pickString(tlsSettings.fingerprint) || pickString(realitySettings.fingerprint)
            ? {
                enabled: true,
                fingerprint:
                  pickString(tlsSettings.fingerprint) ??
                  pickString(realitySettings.fingerprint),
              }
            : undefined,
          reality: security === "reality"
            ? {
                enabled: true,
                public_key: pickString(realitySettings.publicKey),
                short_id: pickString(realitySettings.shortId),
              }
            : undefined,
          echConfigList: pickString(tlsSettings.echConfigList),
          ech: pickString(tlsSettings.echConfigList)
            ? {
                enabled: true,
                config: pickString(tlsSettings.echConfigList),
              }
            : undefined,
        },
      )
    : undefined;

  const transport =
    network === "ws"
      ? withOptional(
          { type: "ws" },
          {
            path: pickString(wsSettings.path),
            headers: isObject(wsSettings.headers) && pickString(wsSettings.headers.Host)
              ? { Host: pickString(wsSettings.headers.Host) }
              : undefined,
          },
        )
      : network === "grpc"
        ? withOptional(
            { type: "grpc" },
            {
              service_name: pickString(grpcSettings.serviceName),
            },
          )
        : network === "http" || network === "h2"
          ? withOptional(
              { type: "http" },
              {
                path: pickString(httpSettings.path),
                host: Array.isArray(httpSettings.host)
                  ? httpSettings.host.filter((item): item is string => typeof item === "string")
                  : undefined,
              },
            )
          : network === "httpupgrade"
            ? withOptional(
                { type: "httpupgrade" },
                {
                  path: pickString(httpupgradeSettings.path),
                  host: pickString(httpupgradeSettings.host),
                },
              )
            : network === "xhttp" || network === "splithttp"
              ? withOptional(
                  { type: "xhttp" },
                  {
                    path: pickString(xhttpSettings.path),
                    host: pickString(xhttpSettings.host),
                    mode: pickString(xhttpSettings.mode),
                    headers:
                      isObject(xhttpSettings.headers) &&
                      Object.keys(xhttpSettings.headers).length > 0
                        ? Object.fromEntries(
                            Object.entries(xhttpSettings.headers).filter(
                              (entry): entry is [string, string] =>
                                typeof entry[1] === "string",
                            ),
                          )
                        : undefined,
                  },
                )
              : undefined;

  if (protocol === "vless" || protocol === "vmess") {
    let server = "";
    let server_port = 443;
    let uuid = "";
    let flow = pickString(settings.flow);
    let security = pickString(settings.security);
    let alter_id = pickNumber(settings.alterId);

    const vnext = Array.isArray(settings.vnext) ? settings.vnext[0] : null;
    const user = isObject(vnext) && Array.isArray(vnext.users) ? vnext.users[0] : null;
    if (isObject(vnext) && isObject(user)) {
      server = pickString(vnext.address) ?? "";
      server_port = pickNumber(vnext.port) ?? 443;
      uuid = pickString(user.id) ?? "";
      flow = pickString(user.flow) ?? flow;
      security = pickString(user.security) ?? security;
      alter_id = pickNumber(user.alterId) ?? alter_id;
    } else if (pickString(settings.address) && pickString(settings.id)) {
      // Flattened Xray JSON format (e.g. tapsell.ir / @VpnMaan)
      server = pickString(settings.address) ?? "";
      server_port = pickNumber(settings.port) ?? 443;
      uuid = pickString(settings.id) ?? "";
    } else {
      return null;
    }

    if (!server || !uuid) return null;

    const dnsHosts = isObject(json.dns) && isObject(json.dns.hosts) ? json.dns.hosts : undefined;

    return withOptional(
      {
        type: protocol,
        tag: "proxy",
        server,
        server_port,
        uuid,
      },
      {
        flow: protocol === "vless" ? flow : undefined,
        security: protocol === "vmess" ? security ?? "auto" : undefined,
        alter_id: protocol === "vmess" ? alter_id ?? 0 : undefined,
        packet_encoding:
          pickString(options.extra.packetEncoding) ??
          pickString(options.extra.packet_encoding) ??
          undefined,
        tls,
        transport,
        multiplex: buildMultiplex(options),
        dns_hosts: dnsHosts,
      },
    );
  }

  if (protocol === "trojan") {
    const server = Array.isArray(settings.servers) ? settings.servers[0] : null;
    if (!isObject(server)) return null;
    return withOptional(
      {
        type: "trojan",
        tag: "proxy",
        server: pickString(server.address) ?? "",
        server_port: pickNumber(server.port) ?? 443,
        password: pickString(server.password) ?? "",
      },
      {
        tls: tls ?? { enabled: true, insecure: options.allowInsecure },
        transport,
        multiplex: buildMultiplex(options),
      },
    );
  }

  if (protocol === "shadowsocks") {
    const server = Array.isArray(settings.servers) ? settings.servers[0] : null;
    if (!isObject(server)) return null;
    return withOptional(
      {
        type: "shadowsocks",
        tag: "proxy",
        server: pickString(server.address) ?? "",
        server_port: pickNumber(server.port) ?? 443,
        method: pickString(server.method) ?? "",
        password: pickString(server.password) ?? "",
      },
      {
        plugin: pickString(server.plugin),
        multiplex: buildMultiplex(options),
      },
    );
  }

  return null;
};

const buildRuntimeProfile = (server: ServerRecord, rawConfig: string): JsonObject => {
  const loweredProtocol = server.protocol.trim().toLowerCase();
  const normalizedProtocol = normalizeProtocol(server.protocol, rawConfig);
  const trimmed = rawConfig.trim();
  const parsedJson = parseJson(trimmed);

  // Helper: Check if outbound requires Xray-core (xhttp/splithttp are Xray-only transports, mlkem requires Xray-core)
  const requiresXray = (outbound: unknown): boolean => {
    if (!isObject(outbound)) return false;
    const transport = (outbound as JsonObject).transport;
    if (isObject(transport)) {
      const type = pickString((transport as JsonObject).type);
      if (type === "xhttp" || type === "splithttp") return true;
    }
    const enc = pickString((outbound as JsonObject).encryption);
    if (enc && enc.toLowerCase() !== "none") return true;
    const tls = (outbound as JsonObject).tls;
    if (isObject(tls)) {
      if (pickString((tls as JsonObject).pinned_peer_cert_sha256)) return true;
      if (pickString((tls as JsonObject).echConfigList)) return true;
    }
    return false;
  };

  if (isObject(parsedJson)) {
    const parsedType = pickString((parsedJson as JsonObject).type);
    if (parsedType && parsedType.toLowerCase() === "dnstt-ssh") {
      return {
        engine: "sing-box",
        supported: true,
        // Admin stores the full sing-box outbound payload for DNSTT-SSH.
        outbound: { ...(parsedJson as JsonObject), tag: "proxy" },
      };
    }
    if (parsedType && (parsedType.toLowerCase() === "ssh-profile" || parsedType.toLowerCase() === "ssh")) {
      return {
        engine: "sing-box",
        supported: true,
        outbound: buildOutboundFromSsh(trimmed),
      };
    }
  }

  if (loweredProtocol.includes("openvpn")) {
    return buildOpenVpnRuntimeProfile(trimmed);
  }

  if (loweredProtocol.includes("warp") || loweredProtocol === "warp") {
    const outbound = isObject(parsedJson) ? parsedJson : { type: "warp", server: trimmed };
    return {
      engine: "warp",
      supported: true,
      outbound,
    };
  }

  if (loweredProtocol.includes("wireguard") || loweredProtocol === "wg") {
    return {
      engine: "wireguard",
      supported: true,
      outbound: buildOutboundFromWireguardProfile(trimmed),
    };
  }

  if (loweredProtocol.startsWith("l2tp")) {
    const l2tpOutbound = isObject(parsedJson) ? { ...parsedJson } : {};
    const allAuths: Array<{ username: string; password: string; psk?: string }> = [];

    // 1. Extra accounts
    if (Array.isArray(l2tpOutbound.auths)) {
      for (const item of l2tpOutbound.auths) {
        if (isObject(item)) {
          const u = pickString(item.username);
          const p = pickString(item.password);
          const k = pickString(item.psk);
          if (u && p) {
            allAuths.push({ username: u, password: p, psk: k });
          }
        }
      }
    }

    // 2. Primary credentials
    const primUser = pickString(l2tpOutbound.username);
    const primPass = pickString(l2tpOutbound.password);
    const primPsk = pickString(l2tpOutbound.psk);

    if (primUser && primPass && !allAuths.some((a) => a.username === primUser && a.password === primPass)) {
      allAuths.unshift({ username: primUser, password: primPass, psk: primPsk });
    }

    // 3. Random selection: if auths exist, pick ONE randomly!
    if (allAuths.length > 0) {
      const chosen = allAuths[Math.floor(Math.random() * allAuths.length)];
      l2tpOutbound.username = chosen.username;
      l2tpOutbound.password = chosen.password;
      if (chosen.psk) {
        l2tpOutbound.psk = chosen.psk;
      } else if (primPsk) {
        l2tpOutbound.psk = primPsk;
      }
    }

    // 4. Strip internal auths list before returning to client so it's not exposed
    delete l2tpOutbound.auths;
    delete l2tpOutbound.authMode;

    return {
      engine: "l2tp",
      supported: true,
      outbound: l2tpOutbound,
    };
  }

  if (isObject(parsedJson)) {
    if (Array.isArray(parsedJson.outbounds)) {
      const singBoxOutbound = parsedJson.outbounds.find((entry) => {
        if (!isObject(entry)) return false;
        const type = pickString(entry.type);
        return Boolean(type && !["direct", "block", "dns"].includes(type));
      });
      if (isObject(singBoxOutbound)) {
        const outbound = withOptional(
          {
            ...singBoxOutbound,
            tag: "proxy",
          },
          {
            multiplex: server.options.mux ? { enabled: true } : singBoxOutbound.multiplex,
          },
        );
        return {
          engine: requiresXray(outbound) ? "xray-core" : "sing-box",
          supported: true,
          outbound,
        };
      }

      const xrayOutbound = buildOutboundFromXrayJson(parsedJson, server.options);
      if (xrayOutbound) {
        return {
          engine: requiresXray(xrayOutbound) ? "xray-core" : "sing-box",
          supported: true,
          outbound: xrayOutbound,
        };
      }
    }

    if (typeof parsedJson.type === "string" && typeof parsedJson.server === "string") {
      const outbound = withOptional(
        {
          ...parsedJson,
          tag: "proxy",
        },
        {
          multiplex: server.options.mux ? { enabled: true } : parsedJson.multiplex,
        },
      );
      return {
        engine: requiresXray(outbound) ? "xray-core" : "sing-box",
        supported: true,
        outbound,
      };
    }
  }

  if (normalizedProtocol === "vless") {
    try {
      const outbound = buildOutboundFromVless(trimmed, server.options);
      return { engine: requiresXray(outbound) ? "xray-core" : "sing-box", supported: true, outbound };
    } catch {
      return { engine: "unsupported", supported: false, reason: "Invalid VLESS format" };
    }
  }
  if (normalizedProtocol === "vmess") {
    try {
      const outbound = buildOutboundFromVmess(trimmed, server.options);
      return { engine: requiresXray(outbound) ? "xray-core" : "sing-box", supported: true, outbound };
    } catch {
      return { engine: "unsupported", supported: false, reason: "Invalid VMess format" };
    }
  }
  if (normalizedProtocol === "trojan") {
    try {
      const outbound = buildOutboundFromTrojan(trimmed, server.options);
      return { engine: requiresXray(outbound) ? "xray-core" : "sing-box", supported: true, outbound };
    } catch {
      return { engine: "unsupported", supported: false, reason: "Invalid Trojan format" };
    }
  }
  if (normalizedProtocol === "shadowsocks") {
    try {
      const outbound = buildOutboundFromShadowsocks(trimmed, server.options);
      return { engine: requiresXray(outbound) ? "xray-core" : "sing-box", supported: true, outbound };
    } catch {
      return { engine: "unsupported", supported: false, reason: "Invalid Shadowsocks format" };
    }
  }
  if (normalizedProtocol === "hysteria2") {
    try {
      const outbound = buildOutboundFromHysteria2(trimmed, server.options);
      return { engine: requiresXray(outbound) ? "xray-core" : "sing-box", supported: true, outbound };
    } catch {
      return { engine: "unsupported", supported: false, reason: "Invalid Hysteria2 format" };
    }
  }
  if (normalizedProtocol === "socks") {
    try {
      const outbound = buildOutboundFromSocks(trimmed, server.options);
      return { engine: "xray", supported: true, outbound };
    } catch {
      return { engine: "unsupported", supported: false, reason: "Invalid Socks format" };
    }
  }
  if (normalizedProtocol === "http") {
    try {
      const outbound = buildOutboundFromHttpUri(trimmed);
      return { engine: requiresXray(outbound) ? "xray-core" : "sing-box", supported: true, outbound };
    } catch {
      return { engine: "unsupported", supported: false, reason: "Invalid HTTP proxy format" };
    }
  }
  if (normalizedProtocol === "ssh") {
    try {
      return { engine: "sing-box", supported: true, outbound: buildOutboundFromSsh(trimmed) };
    } catch {
      return {
        engine: "unsupported",
        supported: false,
        reason: "Invalid SSH profile format for this runtime. DNSTT-SSH must be stored as a DNSTT-SSH JSON payload.",
      };
    }
  }
  return {
    engine: "unsupported",
    supported: false,
    reason:
      normalizedProtocol === "openvpn" || normalizedProtocol === "wireguard"
        ? "This profile type is stored, but not enabled in the desktop runtime path."
        : "Unsupported server format",
  };
};

// In-memory catalog cache with 30s TTL to prevent heavy DB decrypt loops on Vercel
let catalogCache: {
  key: string;
  payload: unknown;
  expiresAt: number;
} | null = null;

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const requestedProtocol = url.searchParams.get("protocol")?.trim().toLowerCase() || "all";
    const cacheKey = requestedProtocol;

    const now = Date.now();
    if (catalogCache && catalogCache.key === cacheKey && catalogCache.expiresAt > now) {
      return NextResponse.json(catalogCache.payload, {
        headers: {
          "Cache-Control": "public, max-age=20, s-maxage=60, stale-while-revalidate=300",
        },
      });
    }

    const servers = await listServers(true);
    const catalogServers = [];

    for (const server of servers) {
      try {
        const rawConfig = decryptConfig(server.encryptedConfig);
        let runtimeProfile: JsonObject;
        try {
          runtimeProfile = buildRuntimeProfile(server, rawConfig);
        } catch (profileErr) {
          console.error(`Failed to build runtime profile for server ${server.id} (${server.name}):`, profileErr);
          runtimeProfile = { engine: "unsupported", supported: false, reason: "Error building profile" };
        }
        catalogServers.push({
          id: server.id,
          name: server.name,
          protocol: server.protocol,
          host: null,
          port: null,
          country: server.country,
          options: server.options,
          rawConfig: "",
          runtimeProfile,
          updatedAt: server.updatedAt,
        });
      } catch (decryptErr) {
        console.error(`Failed to decrypt server ${server.id}:`, decryptErr);
        // Skip individual broken records instead of failing the whole catalog.
      }
    }

    let filteredCatalog = catalogServers;
    if (requestedProtocol && requestedProtocol !== "all") {
      filteredCatalog = catalogServers.filter((s) => {
        const p = s.protocol.toLowerCase();
        if (requestedProtocol === "l2tp") return p.startsWith("l2tp");
        if (requestedProtocol === "v2ray") {
          return (
            p.startsWith("v2ray") ||
            p.startsWith("vless") ||
            p.startsWith("vmess") ||
            p.startsWith("trojan") ||
            p.startsWith("ss:") ||
            p.startsWith("hysteria") ||
            p.startsWith("shadowsocks")
          );
        }
        if (requestedProtocol === "openvpn") return p.startsWith("openvpn");
        if (requestedProtocol === "wireguard" || requestedProtocol === "wg") {
          return p.startsWith("wireguard") || p === "wg";
        }
        if (requestedProtocol === "warp") return p === "warp";
        if (requestedProtocol === "ssh") return p.startsWith("ssh");
        if (requestedProtocol === "http") return p === "http";
        return p === requestedProtocol;
      });
    }

    const { encryptCatalogPayload } = await import("@/lib/client-catalog");
    const encrypted = encryptCatalogPayload({ servers: filteredCatalog });

    catalogCache = {
      key: cacheKey,
      payload: encrypted,
      expiresAt: now + 30 * 1000,
    };

    return NextResponse.json(encrypted, {
      headers: {
        "Cache-Control": "public, max-age=20, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build server catalog";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
