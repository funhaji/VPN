import { NextResponse } from "next/server";
import { decryptConfig } from "@/lib/crypto";
import { listServers } from "@/lib/db";
import type { ProtocolOptions, ServerRecord } from "@/types/server";

export const dynamic = "force-dynamic";

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
  const isReality = defaults?.reality || security === "reality";
  const enabled =
    defaults?.enabled ??
    (isReality ||
      security === "tls" ||
      Boolean(serverName) ||
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
    const ed = parseNumber(url.searchParams.get("ed"), 0);
    return withOptional(
      { type: "ws" },
      {
        path: url.searchParams.get("path") ?? undefined,
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
  if (trimmed.startsWith("ssh://")) return "ssh";
  if (trimmed.startsWith("wg://")) return "wireguard";
  if (lowered.includes("vless")) return "vless";
  if (lowered.includes("vmess")) return "vmess";
  if (lowered.includes("trojan")) return "trojan";
  if (lowered.includes("shadowsocks") || lowered.endsWith(":ss") || lowered === "ss") return "shadowsocks";
  if (lowered.includes("hysteria2") || lowered.includes("hy2")) return "hysteria2";
  if (lowered.includes("ssh")) return "ssh";
  if (lowered.includes("wireguard") || lowered === "wg") return "wireguard";
  if (lowered.includes("openvpn")) return "openvpn";
  return lowered;
};

const buildOutboundFromVless = (
  rawConfig: string,
  options: ProtocolOptions,
): JsonObject => {
  const url = new URL(rawConfig);
  return withOptional(
    {
      type: "vless",
      tag: "proxy",
      server: url.hostname,
      server_port: parseNumber(url.port, 443),
      uuid: decodeURIComponent(url.username),
    },
    {
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

const buildOutboundFromSsh = (
  rawConfig: string,
): JsonObject => {
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
  const parsed = parseJson(rawConfig);
  if (!isObject(parsed) || !isObject(parsed.endpoint)) {
    throw new Error("Invalid WireGuard profile");
  }
  const endpoint = parsed.endpoint;
  const localAddress = Array.isArray(parsed.local_address)
    ? parsed.local_address.filter((item): item is string => typeof item === "string")
    : [];
  const allowedIps = Array.isArray(parsed.allowed_ips)
    ? parsed.allowed_ips.filter((item): item is string => typeof item === "string")
    : undefined;
  const reserved = Array.isArray(parsed.reserved)
    ? parsed.reserved.filter((item): item is number => typeof item === "number")
    : undefined;

  return withOptional(
    {
      type: "wireguard",
      tag: "proxy",
      server: pickString(endpoint.host) ?? "",
      server_port: pickNumber(endpoint.port) ?? 51820,
      local_address: localAddress,
      private_key: pickString(parsed.private_key) ?? "",
      peer_public_key: pickString(parsed.peer_public_key) ?? "",
    },
    {
      pre_shared_key: pickString(parsed.pre_shared_key),
      allowed_ips: allowedIps,
      reserved,
      mtu: pickNumber(parsed.mtu),
    },
  );
};

const buildOpenVpnRuntimeProfile = (rawConfig: string): JsonObject => {
  const parsed = parseJson(rawConfig);
  if (!isObject(parsed) || !isObject(parsed.remote)) {
    throw new Error("Invalid OpenVPN profile");
  }
  const remote = parsed.remote;
  const credentials = isObject(parsed.credentials) ? parsed.credentials : {};
  return {
    engine: "openvpn",
    supported: true,
    outbound: withOptional(
      {
        type: "openvpn-profile",
        host: pickString(remote.host) ?? "",
        port: pickNumber(remote.port) ?? 1194,
        transport: pickString(parsed.transport) ?? "udp",
        profile: pickString(parsed.profile) ?? "",
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
            : undefined;

  if (protocol === "vless" || protocol === "vmess") {
    const vnext = Array.isArray(settings.vnext) ? settings.vnext[0] : null;
    const user = isObject(vnext) && Array.isArray(vnext.users) ? vnext.users[0] : null;
    if (!isObject(vnext) || !isObject(user)) return null;
    return withOptional(
      {
        type: protocol,
        tag: "proxy",
        server: pickString(vnext.address) ?? "",
        server_port: pickNumber(vnext.port) ?? 443,
        uuid: pickString(user.id) ?? "",
      },
      {
        flow: protocol === "vless" ? pickString(user.flow) : undefined,
        security: protocol === "vmess" ? pickString(user.security) ?? "auto" : undefined,
        alter_id: protocol === "vmess" ? pickNumber(user.alterId) ?? 0 : undefined,
        packet_encoding:
          pickString(options.extra.packetEncoding) ??
          pickString(options.extra.packet_encoding) ??
          undefined,
        tls,
        transport,
        multiplex: buildMultiplex(options),
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
  }

  if (loweredProtocol.includes("openvpn")) {
    return buildOpenVpnRuntimeProfile(trimmed);
  }

  if (loweredProtocol.includes("wireguard") || loweredProtocol === "wg") {
    return {
      engine: "sing-box",
      supported: true,
      outbound: buildOutboundFromWireguardProfile(trimmed),
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
        return {
          engine: "sing-box",
          supported: true,
          outbound: withOptional(
            {
              ...singBoxOutbound,
              tag: "proxy",
            },
            {
              multiplex: server.options.mux ? { enabled: true } : singBoxOutbound.multiplex,
            },
          ),
        };
      }

      const xrayOutbound = buildOutboundFromXrayJson(parsedJson, server.options);
      if (xrayOutbound) {
        return {
          engine: "sing-box",
          supported: true,
          outbound: xrayOutbound,
        };
      }
    }

    if (typeof parsedJson.type === "string" && typeof parsedJson.server === "string") {
      return {
        engine: "sing-box",
        supported: true,
        outbound: withOptional(
          {
            ...parsedJson,
            tag: "proxy",
          },
          {
            multiplex: server.options.mux ? { enabled: true } : parsedJson.multiplex,
          },
        ),
      };
    }
  }

  if (normalizedProtocol === "vless") {
    return { engine: "sing-box", supported: true, outbound: buildOutboundFromVless(trimmed, server.options) };
  }
  if (normalizedProtocol === "vmess") {
    return { engine: "sing-box", supported: true, outbound: buildOutboundFromVmess(trimmed, server.options) };
  }
  if (normalizedProtocol === "trojan") {
    return { engine: "sing-box", supported: true, outbound: buildOutboundFromTrojan(trimmed, server.options) };
  }
  if (normalizedProtocol === "shadowsocks") {
    return { engine: "sing-box", supported: true, outbound: buildOutboundFromShadowsocks(trimmed, server.options) };
  }
  if (normalizedProtocol === "hysteria2") {
    return { engine: "sing-box", supported: true, outbound: buildOutboundFromHysteria2(trimmed, server.options) };
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

export async function GET() {
  const servers = await listServers(true);
  return NextResponse.json({
    servers: servers.map((server) => {
      const rawConfig = decryptConfig(server.encryptedConfig);
      return {
        id: server.id,
        name: server.name,
        protocol: server.protocol,
        host: server.host,
        port: server.port,
        country: server.country,
        options: server.options,
        // Public endpoint intentionally omits decrypted profile bodies.
        rawConfig: "",
        runtimeProfile: buildRuntimeProfile(server, rawConfig),
        updatedAt: server.updatedAt,
      };
    }),
  });
}
