import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { createHash, createPublicKey, verify, generateKeyPairSync, sign, randomBytes } from "node:crypto";

// Actual authentication and real signatures, with no database/environment access.
const raw = await readFile(new URL("../../src/lib/premium-proof.ts", import.meta.url), "utf8");
const source = stripTypeScriptTypes(raw.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""));
const load = new Function("createHash", "createPublicKey", "verify", "premiumDb", "ensurePremiumSchema",
  `${source}\nreturn { authenticatePremium, digest };`);
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = keys.publicKey.export({ format: "jwk" });
const canonical = JSON.stringify({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y });

function harness({ blocked = false, replay = false, concurrent = false } = {}) {
  const device = { public_key: "old-key", blocked_at: blocked ? new Date() : null,
    active_subscription: "expired-trial", trial_claimed_at: "history" };
  const queries = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(query);
    if (query.startsWith("SELECT * FROM premium_devices")) {
      if (concurrent && query.includes("FOR UPDATE")) device.public_key = "another-key";
      return [{ ...device }];
    }
    if (query.startsWith("INSERT INTO premium_request_limits")) return [{ hits: 1 }];
    if (query.startsWith("INSERT INTO premium_nonces")) return replay ? [] : [{ nonce: "accepted" }];
    if (query.startsWith("UPDATE premium_devices SET public_key")) { device.public_key = values[0]; return []; }
    if (/^(INSERT INTO premium_security_logs|INSERT INTO premium_devices|UPDATE premium_devices SET device_id|DELETE FROM premium_nonces)/.test(query)) return [];
    throw new Error(`Unexpected SQL: ${query}`);
  };
  sql.begin = callback => callback(sql);
  const api = load(createHash, createPublicKey, verify, () => sql, async () => {});
  function request({ marker = "astro-premium-v1", corrupt = false } = {}) {
    const time = String(Date.now());
    const nonce = randomBytes(24).toString("base64url");
    const body = "{}";
    const message = ["astro-premium-v1", "POST", "/api/premium/recover", "and_0123456789abcdef", "android", marker, time, nonce, api.digest(body)].join("\n");
    const signature = sign("sha256", Buffer.from(message), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    return new Request("https://example.test/api/premium/recover", { method: "POST", headers: {
      "x-astro-device": "and_0123456789abcdef", "x-astro-platform": "android", "x-astro-premium": marker,
      "x-astro-time": time, "x-astro-nonce": nonce, "x-astro-key": Buffer.from(JSON.stringify(jwk)).toString("base64url"),
      "x-astro-signature": corrupt ? "A".repeat(86) : signature,
    } });
  }
  return { ...api, device, queries, request };
}

for (const subscription of [null, "expired-trial", "active-paid"]) {
  test(`reinstall recovers signing key without requiring active entitlement: ${subscription}`, async () => {
    const h = harness();
    h.device.active_subscription = subscription;
    await h.authenticatePremium(h.request(), "{}", { recover: true });
    assert.equal(h.device.public_key, canonical);
    assert.equal(h.device.active_subscription, subscription);
    assert.equal(h.device.trial_claimed_at, "history");
    assert.ok(!h.queries.some(q => /premium_redemptions|premium_subscriptions/.test(q)));
  });
}

for (const [name, options, requestOptions, code] of [
  ["blocked device", { blocked: true }, {}, "device_blocked"],
  ["replayed proof", { replay: true }, {}, "replayed"],
  ["invalid signature", {}, { corrupt: true }, "bad_proof"],
  ["invalid protocol", {}, { marker: "invalid" }, "bad_protocol"],
  ["concurrent key replacement", { concurrent: true }, {}, "identity_rejected"],
]) {
  test(`${name} cannot replace the signing key`, async () => {
    const h = harness(options);
    await assert.rejects(h.authenticatePremium(h.request(requestOptions), "{}", { recover: true }), error => error.code === code);
    assert.ok(!h.queries.some(q => q.startsWith("UPDATE premium_devices SET public_key")));
  });
}

test("ordinary requests cannot silently replace a pinned key", async () => {
  const h = harness();
  await assert.rejects(h.authenticatePremium(h.request(), "{}"), error => error.code === "device_changed");
  assert.equal(h.device.public_key, "old-key");
});
