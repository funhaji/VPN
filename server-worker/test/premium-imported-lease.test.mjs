import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { randomUUID } from "node:crypto";

const source = async file => readFile(new URL(`../../src/lib/${file}.ts`, import.meta.url), "utf8");
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString("base64")}`;
const countries = moduleUrl(await source("countries"));
const profileImport = moduleUrl((await source("profile-import")).replace('"@/lib/countries"', JSON.stringify(countries)));
const imports = await import(profileImport);
// Exercise the real catalog converters without loading Next's request/cache or DB runtime.
const converters = (await source("server-catalog")).split("type CatalogEntry =")[0].replace(/^import .*\r?\n/gm, "");
const { buildRuntimeProfile } = await import(moduleUrl(`import { jumpJumpProfile } from ${JSON.stringify(moduleUrl(await source("jumpjump")))};\nimport { parseWireGuardConf } from ${JSON.stringify(profileImport)};\n${converters}`));
const service = await source("premium-service");
const leaseBody = service.match(/export async function premiumLease\(deviceHash: string, serverId: string\) \{([\s\S]*?)\n\}/)?.[1];
assert.ok(leaseBody);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const jsBody = stripTypeScriptTypes(`async function lease() {${leaseBody}\n}`).replace(/^async function lease\(\) \{/, "").replace(/\}\s*$/, "");
const leaseFor = new AsyncFunction("premiumDb", "premiumAccount", "PremiumError", "decryptConfig", "detectProfileMetadata", "buildRuntimeProfile", "randomUUID", "deviceHash", "serverId", jsBody);
class PremiumError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
const raw = "vless://12345678-1234-1234-1234-123456789abc@provider.example:443?security=tls&sni=provider.example&type=ws&path=%2Fvpn#Germany";
function harness({ config = raw, active = true, revoke = false, rebind = false, disabled = false, missing = false, expiry = Date.now() + 3600_000 } = {}) {
  let accounts = 0;
  let bindings = 0;
  let decrypts = 0;
  const db = async strings => {
    const query = strings.join("?");
    if (query.includes("premium_devices")) return [{ active_subscription: rebind && ++bindings > 1 ? "other" : "sub" }];
    if (query.includes("SELECT * FROM premium_servers")) return missing ? [] : [{ config_json: JSON.stringify({ encrypted: true }) }];
    if (query.includes("SELECT id FROM premium_servers")) return disabled ? [] : [{ id: "server" }];
    if (query.includes("INSERT INTO premium_usage_sessions")) return [];
    throw new Error(`Unexpected query: ${query}`);
  };
  return {
    run: () => leaseFor(() => db, async () => ({ active: active && !(revoke && ++accounts > 1), reference: "SUB-test", trafficLimit: 10000, usedBytes: 100, expiresAt: new Date(expiry).toISOString() }), PremiumError,
      () => { decrypts++; return config; }, imports.detectProfileMetadata, buildRuntimeProfile, randomUUID, "device", "server"),
    get decrypts() { return decrypts; },
  };
}

test("imported provider lease needs no controller and converts share links into a real outbound", async () => {
  const before = Date.now();
  const lease = await harness().run();
  assert.equal(lease.rawConfig, raw);
  assert.equal(lease.runtimeProfile.supported, true);
  assert.equal(lease.runtimeProfile.outbound.server, "provider.example");
  assert.equal(lease.runtimeProfile.outbound.uuid, "12345678-1234-1234-1234-123456789abc");
  assert.ok(Date.parse(lease.expiresAt) > before);
  // Imported credentials have a five-minute app lease, bounded by the plan.
  assert.ok(Date.parse(lease.expiresAt) <= Date.now() + 5 * 60_000);
  assert.doesNotMatch(service, /PREMIUM_CONTROLLER_|\/v1\/leases/);
});
test("imported sing-box JSON retains provider credentials in the authorized lease", async () => {
  const config = JSON.stringify({ type: "trojan", server: "provider.example", server_port: 443, password: "provider-secret", tls: { enabled: true } });
  const lease = await harness({ config }).run();
  assert.equal(lease.runtimeProfile.outbound.password, "provider-secret");
  assert.equal(lease.runtimeProfile.outbound.tag, "proxy");
});
test("imported Xray JSON is converted and JumpJump retains its isolated runtime", async () => {
  const xray = JSON.stringify({ outbounds: [{ protocol: "vless", settings: { vnext: [{ address: "provider.example", port: 443, users: [{ id: "12345678-1234-1234-1234-123456789abc", encryption: "none" }] }] } }] });
  assert.equal((await harness({ config: xray }).run()).runtimeProfile.outbound.server, "provider.example");
  const jumpjump = JSON.stringify({ provider: "jumpjump", version: 1, outbound: { tag: "primary", protocol: "vless", settings: {}, proxySettings: { tag: "detour" } }, extra_outbounds: [{ tag: "detour", protocol: "freedom", settings: {} }] });
  assert.equal((await harness({ config: jumpjump }).run()).runtimeProfile.engine, "xray-jumpjump");
});
test("imported lease expires no later than the subscription", async () => {
  const expiry = Date.now() + 5000;
  assert.equal(Date.parse((await harness({ expiry }).run()).expiresAt), expiry);
});
test("inactive subscribers and missing servers never decrypt provider credentials", async () => {
  for (const options of [{ active: false }, { missing: true }]) {
    const h = harness(options);
    await assert.rejects(h.run(), error => [403, 404].includes(error.status));
    assert.equal(h.decrypts, 0);
  }
});
test("revocation, rebinding and server disable during preparation prevent credential release", async () => {
  for (const options of [{ revoke: true }, { rebind: true }, { disabled: true }]) {
    await assert.rejects(harness(options).run(), error => error.status === 403);
  }
});
test("unsupported imported profiles fail clearly instead of returning unusable credentials", async () => {
  await assert.rejects(harness({ config: "not a supported provider config" }).run(), error => error.status === 422 && error.code === "unsupported_profile");
});
