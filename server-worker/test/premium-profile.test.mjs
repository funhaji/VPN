import test from "node:test";
import assert from "node:assert/strict";
import { jumpJumpProfile } from "../../src/lib/jumpjump.ts";

const profile = () => ({ provider: "jumpjump", version: 1,
  outbound: { tag: "primary", protocol: "vless", settings: {}, proxySettings: { tag: "detour" } },
  extra_outbounds: [{ tag: "detour", protocol: "freedom", settings: {} }] });

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
  const publication = source.match(/export async function compilePublicationCatalog\([\s\S]*?\n\}\n/)?.[0];
  assert.ok(publication, "compilePublicationCatalog must be located");
  assert.match(publication, /listServers\(true,\s*true\)/, "publication catalog must use the premium-filtered server list");
});

test("the premium proof covers device identity only, never the app version (premium previews regression)", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../src/lib/premium-proof.ts", import.meta.url), "utf8");
  assert.ok(!source.includes(".test(version)"), "the server must never gate or block on the app version");
  assert.match(source, /platform, version, marker, time, nonce/, "legacy clients that sign the version must still verify during transition");
  assert.match(source, /platform, marker, time, nonce/, "the current contract signs marker, device ID, platform, time, nonce and body digest only");
});
