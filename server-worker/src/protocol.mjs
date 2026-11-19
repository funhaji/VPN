// Shared by Cloudflare and the Vercel fallback. No IP address is used as identity.
const encoder = new TextEncoder();
export const encode = value => encoder.encode(value);
export function base64url(bytes) {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decode(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 16384) throw new Error("Invalid encoding");
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  if (base64url(bytes) !== value) throw new Error("Noncanonical encoding");
  return bytes;
}
export async function hash(value) {
  return base64url(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encode(value) : value));
}
export function publicKeyFields(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string" || jwk.d !== undefined) throw new Error("Invalid installation key");
  if (decode(jwk.x).length !== 32 || decode(jwk.y).length !== 32) throw new Error("Invalid installation key");
  return { crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y };
}
export async function installationId(jwk) { return hash(JSON.stringify(publicKeyFields(jwk))); }
export function signingInput(method, path, timestamp, nonce, bodyHash) {
  return `astro-v2\n${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}
export async function verifyInstallationRequest(request, body, now = Date.now()) {
  const header = request.headers.get("x-astro-key") ?? "";
  if (header.length > 1024) throw new Error("Invalid installation key");
  const jwk = publicKeyFields(JSON.parse(new TextDecoder().decode(decode(header))));
  const timestamp = request.headers.get("x-astro-time") ?? "";
  const nonce = request.headers.get("x-astro-nonce") ?? "";
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 120_000) throw new Error("Expired request");
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(nonce)) throw new Error("Invalid nonce");
  const url = new URL(request.url);
  if (url.search) throw new Error("Query parameters are not supported");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const signature = decode(request.headers.get("x-astro-signature") ?? "");
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature,
    encode(signingInput(request.method, url.pathname, timestamp, nonce, await hash(body))));
  if (!valid) throw new Error("Invalid installation proof");
  return { id: await installationId(jwk), nonce };
}

export async function signDocument(payload, privateJwk, keyId) {
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const document = base64url(encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encode(`astro-document-v2\n${keyId}\n${document}`));
  return { version: 2, keyId, document, signature: base64url(signature) };
}

// Ephemeral ECDH + HKDF + AES-GCM. The recipient key is included in the signed
// request body. AAD binds the installation, catalog revision, and requested IDs.
export async function encryptResponse(payload, recipient, context) {
  const peer = await crypto.subtle.importKey("jwk", publicKeyFields(recipient), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, ephemeral.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: encode("astro-config-v2") }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const aad = JSON.stringify(context);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encode(aad) }, key, encode(JSON.stringify(payload)));
    return { version: 2, algorithm: "P256-HKDF-SHA256-A256GCM", ephemeralKey: publicKeyFields(await crypto.subtle.exportKey("jwk", ephemeral.publicKey)), salt: base64url(salt), iv: base64url(iv), context, ciphertext: base64url(ciphertext) };
  } finally { secret.fill(0); }
}

export function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 2 || !/^[A-Za-z0-9_-]{43}$/.test(snapshot.revision ?? "") || !Array.isArray(snapshot.servers) || snapshot.servers.length > 20000) throw new Error("Invalid snapshot");
  if (!snapshot.servers.length && snapshot.allServersRemoved !== true) throw new Error("Unauthorized empty snapshot");
  if (snapshot.servers.length && snapshot.allServersRemoved === true) throw new Error("Conflicting removal instruction");
  const ids = new Set();
  for (const server of snapshot.servers) {
    if (!server || typeof server.id !== "string" || !server.id.length || server.id.length > 80 || ids.has(server.id) || !server.runtimeProfile || server.runtimeProfile.supported !== true) throw new Error("Invalid snapshot entry");
    ids.add(server.id);
  }
  return snapshot;
}

export function parseSemver(v) {
  if (typeof v !== "string") return null;
  const clean = v.trim().replace(/^v/i, "");
  const match = clean.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: match[2] !== undefined ? parseInt(match[2], 10) : 0,
    patch: match[3] !== undefined ? parseInt(match[3], 10) : 0,
    prerelease: match[4] || null,
  };
}

export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && pb.prerelease) {
    return pa.prerelease.localeCompare(pb.prerelease);
  }
  return 0;
}

export function semverToBuild(v) {
  const p = parseSemver(v);
  if (!p) return 0;
  return p.major * 1_000_000 + p.minor * 1_000 + p.patch;
}

export function isClientBlocked(policy, platform, version, build) {
  const rule = policy?.[platform];
  if (!rule) return true;
  if (rule.disabled === true) return true;

  // 1. Check version string against blockedVersions and minimumVersion
  if (typeof version === "string" && version.trim()) {
    const v = version.trim();
    if (Array.isArray(rule.blockedVersions) && rule.blockedVersions.some(bv => {
      const bvs = typeof bv === "string" ? bv.trim() : "";
      return bvs && (compareSemver(v, bvs) === 0 || v.toLowerCase() === bvs.toLowerCase());
    })) {
      return true;
    }
    if (rule.minimumVersion && typeof rule.minimumVersion === "string" && rule.minimumVersion.trim() && rule.minimumVersion.trim() !== "0.0.0") {
      if (compareSemver(v, rule.minimumVersion.trim()) < 0) {
        return true;
      }
    }
  }

  // 2. Check build number if provided or derived
  const buildNum = Number.isSafeInteger(build) && build > 0 ? build : semverToBuild(version);
  if (buildNum > 0) {
    if (Array.isArray(rule.blockedBuilds) && rule.blockedBuilds.includes(buildNum)) {
      return true;
    }
    if (Number.isSafeInteger(rule.minimumBuild) && rule.minimumBuild > 0 && buildNum < rule.minimumBuild) {
      return true;
    }
  } else if (!version) {
    // Neither valid build nor valid version provided
    return true;
  }

  return false;
}

export function isBuildBlocked(policy, platform, build) {
  return isClientBlocked(policy, platform, undefined, build);
}

export function validatePolicy(policy) {
  for (const platform of ["android", "windows"]) {
    const rule = policy?.[platform];
    if (!rule || typeof rule.disabled !== "boolean") throw new Error("Invalid policy");
    if (rule.minimumBuild !== undefined && (!Number.isSafeInteger(rule.minimumBuild) || rule.minimumBuild < 0)) throw new Error("Invalid minimum build");
    if (rule.blockedBuilds !== undefined && (!Array.isArray(rule.blockedBuilds) || rule.blockedBuilds.some(b => !Number.isSafeInteger(b) || b < 0))) throw new Error("Invalid blocked builds");
    if (rule.minimumVersion !== undefined && typeof rule.minimumVersion !== "string") throw new Error("Invalid minimum version");
    if (rule.blockedVersions !== undefined && (!Array.isArray(rule.blockedVersions) || rule.blockedVersions.some(v => typeof v !== "string"))) throw new Error("Invalid blocked versions");
  }
  return policy;
}

// Configuration options can contain custom credentials. Only these display
// fields may cross the metadata boundary, including for future import formats.
export function catalogMetadata(server) {
  return {
    id: server.id,
    name: server.name,
    protocol: server.protocol,
    country: server.country,
    host: server.host ?? null,
    port: server.port ?? null,
    options: server.options ?? { mux: false, fragment: false, sniffing: true, allowInsecure: false, extra: {} },
    notice: server.notice,
    updatedAt: server.updatedAt,
    engine: server.runtimeProfile?.engine || server.engine || "sing-box",
    rawConfig: server.rawConfig || "",
    runtimeProfile: server.runtimeProfile ?? { engine: server.engine || "sing-box", supported: true },
  };
}
