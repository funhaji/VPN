import test from "node:test";
import assert from "node:assert/strict";
import { changedServerIds as androidChanges, sameConnection as androidSame } from "../../../android/src/lib/catalogLifecycle.ts";
import { changedServerIds as windowsChanges, sameConnection as windowsSame } from "../../../app/src/lib/catalogLifecycle.ts";

for (const [platform, changes, same] of [["android", androidChanges, androidSame], ["windows", windowsChanges, windowsSame]]) {
  const original = { id: "stable-id", name: "Germany", protocol: "vless", rawConfig: "vless://credential@host",
    runtimeProfile: { supported: true, engine: "xray-core", outbound: { uuid: "credential", server: "host" } }, options: { mux: false } };
  test(`${platform}: deletion and credential changes invalidate pending work`, () => {
    assert.deepEqual([...changes([original], [])], [original.id]);
    const edited = { ...original, runtimeProfile: { ...original.runtimeProfile, outbound: { ...original.runtimeProfile.outbound, uuid: "replacement" } } };
    assert.equal(same(original, edited), false);
    assert.deepEqual([...changes([original], [edited])], [original.id]);
    assert.deepEqual([...changes([original], [{ ...original, id: "different-id" }])], [original.id]);
    assert.equal(same(original, { ...original, options: { mux: true } }), false);
    assert.equal(same(original, { ...original, host: "replacement.example" }), false);
    assert.equal(same(original, { ...original, port: 8443 }), false);
  });
  test(`${platform}: display edits and JSON key order do not interrupt connections`, () => {
    const renamed = { ...original, name: "New label", country: "DE", updatedAt: "later",
      runtimeProfile: { outbound: { server: "host", uuid: "credential" }, engine: "xray-core", supported: true } };
    assert.equal(same(original, renamed), true);
    assert.deepEqual([...changes([original], [renamed])], []);
  });
}
