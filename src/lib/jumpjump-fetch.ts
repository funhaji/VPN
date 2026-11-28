import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { brotliDecompressSync } from "node:zlib";
import { jumpJumpProfile } from "./jumpjump";

// Public protocol constants from the supplied reference, not account credentials.
const REQUEST_KEY = Buffer.from("68rAlnDP3ULuBZomsXZywa6vnxhny3Ty");
const RESPONSE_KEY = Buffer.from("p1X9E3B3auiKDN1Suya13cLduKOuhn7f");
const BOOTSTRAP = ["https://dpd26i7qnwq7d.cloudfront.net", "https://d1kx7xvrk1a2cp.cloudfront.net", "https://d27tr2eirfjzt9.cloudfront.net"];
const metadata = { apkCertInfo: "Cert e53ae7ef98d93786b2179f817840178b58321e71, valid from 2023-07-10T02:49:23Z to 2053-07-10T02:49:23Z, Subject: CN=Android,OU=Android,O=Google Inc.,L=Mountain View,ST=California,C=US, Issuer: CN=Android,OU=Android,O=Google Inc.,L=Mountain View,ST=California,C=US", apkPackageName: "app.jumpjumpvpn.jumpjumpvpn" };
const MAX_BYTES = 4_000_000;
const PROVIDER_DOMAINS = ["likemjar.surf", "peppermintuheat.surf", "beethealer.fit", "kcollectfien.wiki", "lusfun.wiki", "obtusegaintbm.wiki", "qfchaishse.fit"];
type ObjectValue = Record<string, any>;
export type JumpJumpEntry = { id: string; name: string; protocol: string; country: string; rawConfig: string; runtimeProfile: ReturnType<typeof jumpJumpProfile> };

export function encryptEnvelope(value: unknown, key = REQUEST_KEY): Buffer {
  const iv = randomBytes(16);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([iv, cipher.update(Buffer.concat([timestamp, Buffer.from(JSON.stringify(value))])), cipher.final()]);
}

export function decryptEnvelope(data: Buffer): Buffer {
  if (data.length < 32 || data.length % 16) throw new Error("Invalid provider envelope");
  const cipher = createDecipheriv("aes-256-cbc", RESPONSE_KEY, data.subarray(0, 16));
  const plain = Buffer.concat([cipher.update(data.subarray(16)), cipher.final()]);
  if (plain.length < 8) throw new Error("Invalid provider envelope");
  return plain.subarray(8);
}

// Provider-discovered URLs are untrusted: never send session tokens to arbitrary
// hosts, private networks, redirects or cleartext endpoints.
export function providerOrigin(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash ||
      !(/^[a-z0-9-]+\.cloudfront\.net$/i.test(url.hostname) || PROVIDER_DOMAINS.some(domain => url.hostname.endsWith(`.${domain}`))) || url.pathname !== "/") throw new Error("Untrusted provider origin");
  return `https://${url.hostname}`;
}

async function boundedResponse(response: Response): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error("Provider unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BYTES) throw new Error("Provider response too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

export type ProviderApi = (endpoint: string, payload: ObjectValue, origins: string[]) => Promise<ObjectValue>;
export function providerApi(signal: AbortSignal, transport: typeof fetch = fetch): ProviderApi {
  return async (endpoint, payload, origins) => {
    const candidates = [...new Set(origins.flatMap(origin => {
      try { return [providerOrigin(origin)]; } catch { return []; }
    }))].slice(0, 5);
    for (const origin of candidates) {
      signal.throwIfAborted();
      try {
        const response = await transport(`${origin}/api/v1.0/${endpoint}`, {
          method: "POST", cache: "no-store", redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          headers: { "Content-Type": "application/json", "Accept-Encoding": "identity", "User-Agent": "Dart/3.7 (dart:io)",
            "X-Nl-Crypto-Key": "J4zjl/1t7kSyktxbDvyYlw==", "X-NL-Product-Code": "jumpjump",
            "X-Nl-Device": encryptEnvelope(metadata).toString("base64") },
          body: new Uint8Array(encryptEnvelope(payload)),
        });
        let bytes = await boundedResponse(response);
        if (response.headers.has("X-Nl-Crypto-Key")) bytes = decryptEnvelope(bytes);
        if (response.headers.get("X-Nl-Content-Encoding") === "br") bytes = brotliDecompressSync(bytes, { maxOutputLength: MAX_BYTES });
        const result = JSON.parse(bytes.toString("utf8"));
        if (result.success === true) return result;
        if (endpoint === "getNodesV2" && String(result.errorCode) === "52009") return { data: { nodes: [] } };
      } catch { /* Never log sessions, decrypted bodies or upstream diagnostics. */ }
    }
    throw new Error("JumpJump gateways unavailable");
  };
}

export function nodeEntry(group: ObjectValue, node: ObjectValue, index: number): JumpJumpEntry {
  if (node.coreType !== "xray") throw new Error("Unsupported JumpJump core");
  const config = typeof node.coreConfig === "string" ? JSON.parse(node.coreConfig) : node.coreConfig;
  const outbounds = config?.outbounds;
  if (!Array.isArray(outbounds) || !outbounds.length || outbounds.length > 32) throw new Error("Invalid JumpJump outbounds");
  // Xray's first outbound is its default. Preserve every detour, not lossy URLs.
  const profile = { provider: "jumpjump", version: 1, outbound: outbounds[0], extra_outbounds: outbounds.slice(1) };
  const runtimeProfile = jumpJumpProfile(profile);
  const rawConfig = JSON.stringify(profile);
  if (Buffer.byteLength(rawConfig) > 100_000) throw new Error("JumpJump profile too large");
  const identity = createHash("sha256").update(JSON.stringify([group.code, node.nodeId ?? node.id ?? index])).digest("hex").slice(0, 24);
  const country = typeof group.country === "string" && /^[A-Za-z]{2}$/.test(group.country) ? group.country.toUpperCase() : "GLOBAL";
  return { id: `jumpjump-${identity}`, name: `JumpJump ${String(group.name || group.code).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 42)} · ${identity.slice(0, 6)}`,
    protocol: `jumpjump:${profile.outbound.protocol}`, country, rawConfig, runtimeProfile };
}

export async function fetchJumpJump(api: ProviderApi): Promise<JumpJumpEntry[]> {
  const deviceId = randomBytes(8).toString("hex");
  const payload = { productId: 10001, platform: "mobile-android", channel: "google", appVer: 352, lang: "en", deviceId,
    deviceModel: "Pixel 7", deviceOs: "Android 13", fingerprintRawDatas: { keychain: "", googleID: "", gsfID: "", mediaID: "", androidID: deviceId } };
  const config = await api("config", { ...payload, authorization: "" }, BOOTSTRAP);
  const origins = config.data.appConfig;
  // Login must be sequential: simultaneous guest logins invalidate sessions.
  const login = await api("guestLogin", payload, origins.apis);
  const groups = login.data.groups.normal.list.filter((g: ObjectValue) => g.memberLevel === 0);
  if (!groups.length || groups.length > 100) throw new Error("No valid free JumpJump groups");
  const { fingerprintRawDatas: _, ...base } = payload;
  const nodeBase = { ...base, authorization: login.data.userConfig.authorization, fetchCount: 4, clientConfig: {
    platformOs: "android", logLevel: "none", inboundsSocksPort: 10808, inboundsDirectSocksPort: 10809,
    routingMode: "all", routingCountryCode: "us", sniffingDomainsExcluded: [], outboundsDnsttPorts: [10811, 10812],
    supportSniffOverrideDestination: true, outboundsByedpiSocksPort: 10810 } };
  const entries: JumpJumpEntry[] = [];
  let next = 0;
  // Fail the whole refresh on partial network/parser failures: never turn them
  // into deletions of previously working locations.
  await Promise.all(Array.from({ length: Math.min(8, groups.length) }, async () => {
    while (next < groups.length) {
      const group = groups[next++];
      const result = await api("getNodesV2", { ...nodeBase, groupParam: group.param }, origins.routers);
      if (!Array.isArray(result.data.nodes) || result.data.nodes.length > 32) throw new Error("Invalid JumpJump nodes");
      result.data.nodes.forEach((node: ObjectValue, index: number) => entries.push(nodeEntry(group, node, index)));
    }
  }));
  const unique = [...new Map(entries.map(entry => [entry.id, entry])).values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!unique.length || unique.length > 500 || Buffer.byteLength(JSON.stringify(unique)) > MAX_BYTES) throw new Error("No complete JumpJump catalog");
  return unique;
}
