import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { jumpJumpProfile } from "../../src/lib/jumpjump.ts";

const profile = () => ({ provider: "jumpjump", version: 1,
  outbound: { tag: "primary", protocol: "vless", settings: {}, proxySettings: { tag: "detour" } },
  extra_outbounds: [{ tag: "detour", protocol: "freedom", settings: {} }] });

test("premium admin uses the authenticated native device ID without resetting hashed trial bindings", async () => {
  const proof = await readFile(new URL("../../src/lib/premium-proof.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../../src/lib/premium-db.ts", import.meta.url), "utf8");
  const admin = await readFile(new URL("../../src/app/api/admin/premium/route.ts", import.meta.url), "utf8");
  assert.match(proof, /const deviceHash = digest\(device\)/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS device_id TEXT/);
  assert.ok(proof.indexOf("SET device_id =") > proof.indexOf("if (pinned.public_key !== canonicalKey"));
  assert.match(admin, /LEFT JOIN premium_devices d ON d.device_hash = l.device_hash/);
  assert.match(admin, /SELECT device_hash, device_id, platform, blocked_at/);
});

test("JumpJump preserves the full outbound contract and selects its isolated runtime", () => {
  const input = profile();
  const result = jumpJumpProfile(input);
  assert.equal(result.engine, "xray-jumpjump");
  assert.deepEqual(result.outbound.outbound, input.outbound);
  assert.deepEqual(result.outbound.extra_outbounds, input.extra_outbounds);
  assert.equal(input.outbound.tag, "primary");
});
test("JumpJump fails closed on partial, ambiguous or unsupported contracts", () => {
  for (const invalid of [null, {}, { ...profile(), version: 2 }, { ...profile(), extra_outbounds: [] },
    { ...profile(), outbound: { tag: "primary", protocol: "vmess" } },
    { ...profile(), extra_outbounds: [{ tag: "primary", protocol: "freedom" }] }]) assert.throws(() => jumpJumpProfile(invalid));
});
test("JumpJump rejects malformed and cyclic detours", () => {
  const cycle = profile();
  cycle.extra_outbounds[0].proxySettings = { tag: "primary" };
  assert.throws(() => jumpJumpProfile(cycle), /Cyclic/);
  for (const tag of ["", 42, {}, null]) {
    const input = profile();
    input.outbound.proxySettings.tag = tag;
    assert.throws(() => jumpJumpProfile(input));
  }
});

test("the published (V2) catalog excludes premium servers so legacy clients cannot connect to them for free", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../src/lib/server-catalog.ts", import.meta.url), "utf8");
  const publication = source.match(/export async function compilePublicationCatalog\([\s\S]*?\r?\n\}\r?\n/)?.[0];
  assert.ok(publication, "compilePublicationCatalog must be located");
  assert.match(publication, /listServers\(true,\s*true\)/, "publication catalog must use the premium-filtered server list");
});

test("a signing-key mismatch is rejected without a permanent device or IP block", async () => {
  const route = await readFile(new URL("../../src/app/api/premium/[operation]/route.ts", import.meta.url), "utf8");
  const gate = route.match(/if \(error instanceof PremiumError && \[([\s\S]*?)\]\.includes\(error\.code\)\)/);
  assert.ok(gate, "punitive premium error codes must be listed explicitly");
  assert.doesNotMatch(gate[1], /device_changed|identity_rejected/);
  for (const code of ["bad_proof", "device_blocked", "replayed", "bad_protocol"]) assert.match(gate[1], new RegExp(code));
  const proof = await readFile(new URL("../../src/lib/premium-proof.ts", import.meta.url), "utf8");
  assert.match(proof, /if \(pinned\.public_key !== canonicalKey\) throw new PremiumError\("Device identity rejected"/);
  assert.ok(proof.indexOf('throw new PremiumError("Device identity rejected"') < proof.indexOf("if (pinned.blocked_at)"));
});

test("the premium proof covers device identity only, never the app version (premium previews regression)", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../src/lib/premium-proof.ts", import.meta.url), "utf8");
  assert.ok(!source.includes(".test(version)"), "the server must never gate or block on the app version");
  assert.match(source, /platform, version, marker, time, nonce/, "legacy clients that sign the version must still verify during transition");
  assert.match(source, /platform, marker, time, nonce/, "the current contract signs marker, device ID, platform, time, nonce and body digest only");
});

test("free-tier premium previews expose names only — no ids, ping targets or node data (premium catalog regression)", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../src/lib/premium-service.ts", import.meta.url), "utf8");
  const fn = source.match(/export async function premiumPreviews\([\s\S]*?\r?\n\}\r?\n/)?.[0];
  assert.ok(fn, "premiumPreviews must be located");
  assert.match(fn, /if \(!account\.active\) return \{ name: row\.name, country: row\.country \};/, "rows without an active subscription must carry name and country only");
  assert.ok(!/id: row\.id/.test(fn.split("if (!account.active)")[0]), "the free-tier branch must not include the server id");
  assert.match(fn, /id: row\.id, name: row\.name[\s\S]*pingPort: ping\?\.port/, "subscriber path keeps ids and ping targets");
});
