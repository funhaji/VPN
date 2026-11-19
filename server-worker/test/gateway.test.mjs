import test from "node:test";
import assert from "node:assert/strict";
import { gateway } from "../src/gateway.mjs";
import { base64url, decode, encode, hash, publicKeyFields, signingInput, verifyInstallationRequest } from "../src/protocol.mjs";
import { createAdapter, openPublication, publishCatalog, sealPublication } from "../src/storage.mjs";

const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const identity = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = publicKeyFields(await crypto.subtle.exportKey("jwk", identity.publicKey));
const signingKey = await crypto.subtle.exportKey("jwk", signing.privateKey);
const policy = { android: { disabled: false, minimumBuild: 10, blockedBuilds: [11] }, windows: { disabled: false, minimumBuild: 1, blockedBuilds: [] } };
const snapshot = { version: 2, revision: await hash("catalog"), allServersRemoved: false, servers: [
  { id: "server-a", name: "Server", protocol: "vless", country: "DE", rawConfig: "SECRET", options: { extra: { password: "SECRET" } }, runtimeProfile: { supported: true, engine: "sing-box", outbound: { password: "SECRET" } } },
] };
const publication = { generation: 1, policy, snapshot };
function adapter(overrides = {}) {
  const nonces = new Set();
  return { signingKey, keyId: "test", publication: async () => publication,
    consume: async (id, nonce) => { const key = `${id}:${nonce}`; if (nonces.has(key)) return { allowed: false, replay: true }; nonces.add(key); return { allowed: true }; }, ...overrides };
}
async function request(path = "/v2/catalog", input = { platform: "android", build: 10 }, options = {}) {
  const body = JSON.stringify(input);
  const timestamp = String(options.time ?? Date.now());
  const nonce = options.nonce ?? base64url(crypto.getRandomValues(new Uint8Array(24)));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, identity.privateKey, encode(signingInput("POST", path, timestamp, nonce, await hash(body))));
  return new Request(`https://primary.example${path}`, { method: "POST", body,
    headers: { "x-astro-key": base64url(encode(JSON.stringify(jwk))), "x-astro-time": timestamp, "x-astro-nonce": nonce, "x-astro-signature": base64url(signature), ...options.headers } });
}
async function signedBody(response) {
  const wrapper = await response.json();
  assert.equal(wrapper.version, 2);
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, signing.publicKey, decode(wrapper.signature), encode(`astro-document-v2\n${wrapper.keyId}\n${wrapper.document}`)), true);
  return JSON.parse(Buffer.from(wrapper.document, "base64url").toString());
}

test("catalog delivery provides complete server profiles for native client engines", async () => {
  const req = await request();
  const response = await gateway(req, adapter());
  assert.equal(response.status, 200);
  const body = await signedBody(response);
  assert.equal(body.nonce, req.headers.get("x-astro-nonce"));
  assert.equal(body.generation, 1);
  assert.equal(body.servers[0].engine, "sing-box");
  assert.ok(body.servers[0].runtimeProfile);
});

test("proofs tolerate carrier IP changes but reject payload tampering, stale time, and replay", async () => {
  const req = await request();
  const body = await req.clone().text();
  const changedNetwork = new Request("https://fallback.example/v2/catalog", { method: "POST", body, headers: { ...Object.fromEntries(req.headers), "x-forwarded-for": "203.0.113.9" } });
  const first = await verifyInstallationRequest(req, encode(body));
  assert.deepEqual(await verifyInstallationRequest(changedNetwork, encode(body)), first);
  await assert.rejects(verifyInstallationRequest(req, encode(body + " ")));
  assert.equal((await gateway(await request(undefined, undefined, { time: Date.now() - 121000 }), adapter())).status, 401);
  const shared = adapter();
  assert.equal((await gateway(req.clone(), shared)).status, 200);
  assert.equal((await gateway(changedNetwork, shared)).status, 409);
});

test("blocked builds receive signed update policy and can still request policy", async () => {
  for (const build of [9, 11]) {
    const response = await gateway(await request("/v2/catalog", { platform: "android", build }), adapter());
    assert.equal(response.status, 426);
    const body = await response.json();
    assert.equal((await signedBody(Response.json(body.policy))).android.minimumBuild, 10);
  }
  assert.equal((await gateway(await request("/v2/policy", { platform: "android", build: 9 }), adapter())).status, 200);
});

test("invalid input, unauthorized empty catalogs, and unavailable authority fail closed", async () => {
  assert.equal((await gateway(await request("/v2/catalog", null), adapter())).status, 400);
  assert.equal((await gateway(await request("/v2/catalog", { platform: "android", build: 10, pad: "x".repeat(9000) }), adapter())).status, 413);
  assert.equal((await gateway(await request(), adapter({ publication: async () => ({ ...publication, snapshot: { ...snapshot, servers: [] } }) }))).status, 503);
  assert.equal((await gateway(await request(), adapter({ consume: async () => { throw new Error("offline"); } }))).status, 503);
  assert.equal((await gateway(await request(), adapter({ consume: async () => ({ allowed: false }) }))).status, 429);
  const removed = await gateway(await request(), adapter({ publication: async () => ({ ...publication, snapshot: { ...snapshot, servers: [], allServersRemoved: true } }) }));
  assert.equal((await signedBody(removed)).allServersRemoved, true);
});

test("config batches enforce revisions, removals, bounds, recipient binding and authenticated encryption", async () => {
  const recipient = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const input = { platform: "android", build: 10, revision: snapshot.revision, ids: ["server-a"], recipientKey: publicKeyFields(await crypto.subtle.exportKey("jwk", recipient.publicKey)) };
  for (const [change, status] of [[{ revision: "old" }, 409], [{ ids: ["removed"] }, 410], [{ ids: ["server-a", "server-a"] }, 400], [{ ids: Array.from({ length: 13 }, (_, i) => String(i)) }, 400]]) {
    assert.equal((await gateway(await request("/v2/configs", { ...input, ...change }), adapter())).status, status);
  }
  const response = await gateway(await request("/v2/configs", input), adapter());
  const envelope = await signedBody(response);
  const peer = await crypto.subtle.importKey("jwk", envelope.ephemeralKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, recipient.privateKey, 256);
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: decode(envelope.salt), info: encode("astro-config-v2") }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const params = { name: "AES-GCM", iv: decode(envelope.iv), additionalData: encode(JSON.stringify(envelope.context)) };
  const plain = await crypto.subtle.decrypt(params, key, decode(envelope.ciphertext));
  assert.equal(JSON.parse(new TextDecoder().decode(plain)).servers[0].runtimeProfile.outbound.password, "SECRET");
  await assert.rejects(crypto.subtle.decrypt({ ...params, additionalData: encode("wrong installation") }, key, decode(envelope.ciphertext)));
});

test("publication encryption rejects tampering and supports large catalogs", async () => {
  const env = { V2_STORAGE_KEY: base64url(crypto.getRandomValues(new Uint8Array(32))) };
  const large = { ...publication, snapshot: { ...snapshot, servers: [{ ...snapshot.servers[0], rawConfig: "x".repeat(20000) }] } };
  const encrypted = await sealPublication(large, env);
  assert.deepEqual(await openPublication(encrypted, env), large);
  const changed = JSON.parse(encrypted); changed.generation++;
  await assert.rejects(openPublication(JSON.stringify(changed), env));
  await assert.rejects(openPublication(encrypted, { V2_STORAGE_KEY: base64url(crypto.getRandomValues(new Uint8Array(32))) }));
});

test("adapters use the same installation keys regardless of host; publication uses CAS", async () => {
  const commands = [];
  const env = { V2_SIGNING_PRIVATE_JWK: JSON.stringify(signingKey), V2_SIGNING_KEY_ID: "test", V2_STORAGE_KEY: base64url(crypto.getRandomValues(new Uint8Array(32))) };
  const command = async args => { commands.push(args); return [1, 0]; };
  const a = createAdapter(env, command), b = createAdapter(env, command);
  const id = await hash("installation"), nonce = base64url(crypto.getRandomValues(new Uint8Array(24)));
  await a.consume(id, nonce, 12); await b.consume(id, nonce, 12);
  assert.deepEqual(commands[0], commands[1]);
  const catalog = { servers: snapshot.servers, allServersRemoved: false };
  assert.equal((await publishCatalog(catalog, policy, 4, env, async args => { assert.equal(args[5], 4); return 5; })).generation, 5);
  await assert.rejects(publishCatalog(catalog, policy, 4, env, async () => 0), /Publication changed/);
  await assert.rejects(publishCatalog({ servers: [], allServersRemoved: false }, policy, 4, env, async () => 5), /Unauthorized empty/);
});

test("publication reuse checks the shared generation and never uses cache during authority failure", async () => {
  const env = { V2_REDIS_REST_URL: "https://cache-test.example", V2_SIGNING_PRIVATE_JWK: JSON.stringify(signingKey), V2_SIGNING_KEY_ID: "test", V2_STORAGE_KEY: base64url(crypto.getRandomValues(new Uint8Array(32))) };
  let current = publication, offline = false, reads = 0;
  const command = async args => {
    if (offline) throw new Error("offline");
    if (args[1].endsWith(":generation")) return String(current.generation);
    reads++;
    return sealPublication(current, env);
  };
  const store = createAdapter(env, command);
  assert.equal((await store.publication()).generation, 1);
  assert.equal((await store.publication()).generation, 1);
  assert.equal(reads, 1);
  current = { ...publication, generation: 2, snapshot: { ...snapshot, servers: [], allServersRemoved: true } };
  assert.equal((await store.publication()).snapshot.servers.length, 0);
  assert.equal(reads, 2);
  offline = true;
  await assert.rejects(store.publication());
});

test("semver version blocking and kill switch enforce minimum and blocked versions", async () => {
  const semverPolicy = {
    android: { disabled: false, minimumVersion: "1.3.0", blockedVersions: ["1.2.7", "1.2.8"], minimumBuild: 0, blockedBuilds: [] },
    windows: { disabled: false, minimumVersion: "1.2.0", blockedVersions: ["1.2.2"], minimumBuild: 0, blockedBuilds: [] },
  };
  const semverAdapter = adapter({ publication: async () => ({ ...publication, policy: semverPolicy }) });

  // 1. Allowed version 1.3.0 on android
  const okReq = await request("/v2/catalog", { platform: "android", version: "1.3.0" });
  const okRes = await gateway(okReq, semverAdapter);
  assert.equal(okRes.status, 200);

  // 2. Blocked specific version 1.2.7
  const blockedReq = await request("/v2/catalog", { platform: "android", version: "1.2.7" });
  const blockedRes = await gateway(blockedReq, semverAdapter);
  assert.equal(blockedRes.status, 426);

  // 3. Below minimum version 1.2.0 (min is 1.3.0)
  const belowMinReq = await request("/v2/catalog", { platform: "android", version: "1.2.0" });
  const belowMinRes = await gateway(belowMinReq, semverAdapter);
  assert.equal(belowMinRes.status, 426);

  // 4. Kill switch: require all versions to update
  const killSwitchPolicy = {
    android: { disabled: true, minimumVersion: "0.0.0", blockedVersions: [], minimumBuild: 0, blockedBuilds: [] },
    windows: { disabled: false, minimumVersion: "0.0.0", blockedVersions: [], minimumBuild: 0, blockedBuilds: [] },
  };
  const killSwitchAdapter = adapter({ publication: async () => ({ ...publication, policy: killSwitchPolicy }) });
  const killRes = await gateway(await request("/v2/catalog", { platform: "android", version: "1.3.0" }), killSwitchAdapter);
  assert.equal(killRes.status, 426);
});

test("in-memory storage fallback works seamlessly when Redis is absent", async () => {
  const emptyEnv = {};
  const memAdapter = createAdapter(emptyEnv);
  assert.equal(typeof memAdapter.consume, "function");
  const res = await memAdapter.consume("a".repeat(43), "b".repeat(24), 1);
  assert.equal(res.allowed, true);
});
