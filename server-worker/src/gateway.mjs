import { catalogMetadata, encryptResponse, isBuildBlocked, isClientBlocked, signDocument, validatePolicy, validateSnapshot, verifyInstallationRequest } from "./protocol.mjs";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-astro-key, x-astro-time, x-astro-nonce, x-astro-signature, x-astro-version, x-astro-build",
  "Access-Control-Max-Age": "86400",
};
const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });

/** Storage/rate adapters differ; auth, policy and response rules never do. */
export async function gateway(request, adapter) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const path = new URL(request.url).pathname;
  if (!["/v2/policy", "/v2/catalog", "/v2/configs"].includes(path)) return reply({ error: "Not found" }, 404);
  if (request.method !== "POST") return reply({ error: "Use POST" }, 405);
  if (Number(request.headers.get("content-length") ?? 0) > 8192) return reply({ error: "Request too large" }, 413);
  // Stream with a cap; content-length cannot be trusted.
  const reader = request.body?.getReader();
  const chunks = []; let length = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 8192) { await reader.cancel(); return reply({ error: "Request too large" }, 413); }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let installation;
  try { installation = await verifyInstallationRequest(request, bytes); }
  catch { return reply({ error: "Invalid installation proof" }, 401); }
  let input;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return reply({ error: "Invalid JSON" }, 400); }
  if (!input || !["android", "windows"].includes(input.platform)) return reply({ error: "Invalid platform" }, 400);
  const hasValidBuild = Number.isSafeInteger(input.build) && input.build >= 1;
  const hasValidVersion = typeof input.version === "string" && input.version.trim().length > 0 && input.version.length <= 32;
  if (!hasValidBuild && !hasValidVersion) return reply({ error: "Invalid platform/build/version" }, 400);
  const ids = input.ids;
  if (path === "/v2/configs" && (!Array.isArray(ids) || !ids.length || ids.length > 12 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || id.length > 80))) return reply({ error: "Request 1–12 distinct server IDs" }, 400);
  try {
    const result = await adapter.consume(installation.id, installation.nonce, path === "/v2/configs" ? ids.length : 1);
    if (!result.allowed) return reply({ error: result.replay ? "Request replay" : "Installation rate limit" }, result.replay ? 409 : 429, { "Retry-After": "60" });
    // One atomic publication supplies both policy and catalog. Never mix a new
    // policy with a stale catalog from a different storage read.
    const publication = await adapter.publication();
    const policy = validatePolicy(publication.policy);
    const issuedAt = Date.now();
    const binding = { installation: installation.id, nonce: installation.nonce, generation: publication.generation };
    const signedPolicy = await signDocument({ ...policy, ...binding, issuedAt, expiresAt: issuedAt + 300_000 }, adapter.signingKey, adapter.keyId);
    if (path === "/v2/policy") return reply(signedPolicy);
    if (isClientBlocked(policy, input.platform, input.version, input.build)) return reply({ error: "Update required", policy: signedPolicy }, 426);
    const snapshot = validateSnapshot(publication.snapshot);
    if (path === "/v2/catalog") {
      return reply(await signDocument({ version: 2, ...binding, revision: snapshot.revision, issuedAt, expiresAt: issuedAt + 300_000,
        allServersRemoved: snapshot.allServersRemoved === true,
        servers: snapshot.servers.map(catalogMetadata),
      }, adapter.signingKey, adapter.keyId));
    }
    if (input.revision !== snapshot.revision) return reply({ error: "Catalog changed; refresh before retrying" }, 409);
    const selected = ids.map(id => snapshot.servers.find(server => server.id === id));
    if (selected.some(server => !server)) return reply({ error: "Server removed; refresh catalog" }, 410);
    let encrypted;
    try {
      encrypted = await encryptResponse({ servers: selected }, input.recipientKey,
        { ...binding, revision: snapshot.revision, ids, issuedAt, expiresAt: issuedAt + 300_000 });
    } catch { return reply({ error: "Invalid recipient key" }, 400); }
    return reply(await signDocument(encrypted, adapter.signingKey, adapter.keyId));
  } catch {
    return reply({ error: "Service temporarily unavailable" }, 503);
  }
}
