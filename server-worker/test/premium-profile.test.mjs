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
