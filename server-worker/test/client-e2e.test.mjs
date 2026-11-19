import test from "node:test";
import assert from "node:assert/strict";
import { gateway } from "../src/gateway.mjs";
import {
  base64url,
  decode,
  encode,
  hash,
  publicKeyFields,
  signingInput,
  parseSemver,
  compareSemver,
  isClientBlocked,
} from "../src/protocol.mjs";
import { createAdapter, publishCatalog } from "../src/storage.mjs";

test("V2 client end-to-end: catalog fetch, config decryption, and semver version gating", async () => {
  // 1. Setup mock server state with in-memory adapter
  const env = { V2_SIGNING_KEY_ID: "astro-test-key" };
  const adapter = createAdapter(env);

  const testPolicy = {
    legacyEnabled: false,
    allServersRemoved: false,
    android: {
      minimumVersion: "1.3.0",
      blockedVersions: ["1.2.7", "1.2.8"],
      minimumBuild: 1003000,
      blockedBuilds: [1002007, 1002008],
      disabled: false,
    },
    windows: {
      minimumVersion: "1.2.3",
      blockedVersions: ["1.2.0"],
      minimumBuild: 1002003,
      blockedBuilds: [],
      disabled: false,
    },
    messageEn: "Update required to continue.",
    messageFa: "لطفاً برنامه را به‌روزرسانی کنید.",
  };

  const testCatalog = {
    allServersRemoved: false,
    servers: [
      {
        id: "srv-de-1",
        name: "Germany Frankfurt #1",
        protocol: "vless",
        country: "DE",
        rawConfig: "vless://12345678-1234-1234-1234-123456789abc@de.example.com:443?security=reality",
        options: { mux: false, fragment: false, sniffing: true, allowInsecure: false, extra: {} },
        runtimeProfile: {
          supported: true,
          engine: "sing-box",
          outbound: { type: "vless", server: "de.example.com", server_port: 443 },
        },
        updatedAt: String(Date.now()),
      },
      {
        id: "srv-nl-1",
        name: "Netherlands Amsterdam #1",
        protocol: "vmess",
        country: "NL",
        rawConfig: "vmess://eyJ2IjoiMiIsInBzIjoiTkwiLCJhZGQiOiJubC5leGFtcGxlLmNvbSJ9",
        options: { mux: false, fragment: false, sniffing: true, allowInsecure: false, extra: {} },
        runtimeProfile: {
          supported: true,
          engine: "xray",
          outbound: { type: "vmess", server: "nl.example.com", server_port: 443 },
        },
        updatedAt: String(Date.now()),
      },
    ],
  };

  // Publish generation 1
  const pub = await publishCatalog(testCatalog, testPolicy, 0, env);
  assert.equal(pub.generation, 1);

  // 2. Client Side Simulation
  // Generate installation persistent key pair
  const installKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const installJwk = publicKeyFields(await crypto.subtle.exportKey("jwk", installKey.publicKey));

  async function clientSignRequest(method, path, bodyObj) {
    const bodyStr = JSON.stringify(bodyObj);
    const bodyBytes = encode(bodyStr);
    const bodyDigest = await hash(bodyBytes);
    const timestamp = String(Date.now());
    const nonce = base64url(crypto.getRandomValues(new Uint8Array(24)));
    const sigInput = signingInput(method, path, timestamp, nonce, bodyDigest);
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, installKey.privateKey, encode(sigInput));

    return new Request(`https://astrovpn.vercel.app${path}`, {
      method,
      body: bodyStr,
      headers: {
        "x-astro-key": base64url(encode(JSON.stringify(installJwk))),
        "x-astro-time": timestamp,
        "x-astro-nonce": nonce,
        "x-astro-signature": base64url(sig),
        "content-type": "application/json",
      },
    });
  }

  // 3. Test: Android 1.3.0 fetches catalog (Allowed)
  const catReq = await clientSignRequest("POST", "/v2/catalog", {
    platform: "android",
    version: "1.3.0",
  });
  const catRes = await gateway(catReq, adapter);
  assert.equal(catRes.status, 200);
  const catDoc = await catRes.json();
  assert.equal(catDoc.version, 2);
  const catalogPayload = JSON.parse(new TextDecoder().decode(decode(catDoc.document)));
  assert.equal(catalogPayload.servers.length, 2);
  assert.equal(catalogPayload.servers[0].id, "srv-de-1");
  assert.equal(catalogPayload.servers[0].name, "Germany Frankfurt #1");
  assert.equal(catalogPayload.servers[0].engine, "sing-box");
  // Check that rawConfig is NOT leaked in catalog metadata
  assert.equal(catalogPayload.servers[0].rawConfig, undefined);

  // 4. Test: Blocked version 1.2.7 gets 426
  const blockedReq = await clientSignRequest("POST", "/v2/catalog", {
    platform: "android",
    version: "1.2.7",
  });
  const blockedRes = await gateway(blockedReq, adapter);
  assert.equal(blockedRes.status, 426);

  // 5. Test: Outdated version 1.2.2 gets 426 (minimum is 1.3.0)
  const outdatedReq = await clientSignRequest("POST", "/v2/catalog", {
    platform: "android",
    version: "1.2.2",
  });
  const outdatedRes = await gateway(outdatedReq, adapter);
  assert.equal(outdatedRes.status, 426);

  // 6. Test: Config decryption for selected server
  const recipient = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const recipientJwk = publicKeyFields(await crypto.subtle.exportKey("jwk", recipient.publicKey));

  const cfgReq = await clientSignRequest("POST", "/v2/configs", {
    platform: "android",
    version: "1.3.0",
    revision: catalogPayload.revision,
    ids: ["srv-de-1"],
    recipientKey: recipientJwk,
  });
  const cfgRes = await gateway(cfgReq, adapter);
  assert.equal(cfgRes.status, 200);
  const cfgEnvelopeWrapper = await cfgRes.json();
  assert.equal(cfgEnvelopeWrapper.version, 2);

  // Client decrypts config envelope
  const envelope = JSON.parse(new TextDecoder().decode(decode(cfgEnvelopeWrapper.document)));
  const peer = await crypto.subtle.importKey("jwk", envelope.ephemeralKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, recipient.privateKey, 256));
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: decode(envelope.salt), info: encode("astro-config-v2") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plainBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(envelope.iv), additionalData: encode(JSON.stringify(envelope.context)) },
    key,
    decode(envelope.ciphertext)
  );
  const decrypted = JSON.parse(new TextDecoder().decode(plainBytes));
  assert.equal(decrypted.servers.length, 1);
  assert.equal(decrypted.servers[0].id, "srv-de-1");
  assert.equal(decrypted.servers[0].rawConfig.startsWith("vless://"), true);
  assert.equal(decrypted.servers[0].runtimeProfile.engine, "sing-box");
});
