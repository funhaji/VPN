import test from "node:test";
import assert from "node:assert/strict";
import { validateCatalog as android } from "../../../android/src/lib/catalogValidation.ts";
import { validateCatalog as windows } from "../../../app/src/lib/catalogValidation.ts";
import { findServerDuplicates, normalizeHost } from "../../src/lib/server-duplicates.ts";
import { legacyNoticeEntries } from "../../src/lib/legacy-notice-entries.ts";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { catalogGeneration } from "../../src/lib/catalog-generation.ts";

for (const [platform, validate] of [["android", android], ["windows", windows]]) {
  test(`${platform} requires literal authorization and rejects conflicting deletion`, () => {
    for (const value of [null, [], {}, { servers: [] }, { servers: [], allServersRemoved: "true" }, { servers: [{}], allServersRemoved: true }]) assert.throws(() => validate(value));
    assert.deepEqual(validate({ servers: [], allServersRemoved: true }), { servers: [], allServersRemoved: true });
    assert.deepEqual(validate({ servers: [{ id: "a" }] }), { servers: [{ id: "a" }], allServersRemoved: false });
  });
}

const candidate = (name, rawConfig) => ({ name, rawConfig, protocol: "vless" });
test("legacy removal authorization is tied to stored catalog state", () => {
  const a = { id: "a", updatedAt: "2026-01-01", isEnabled: false };
  const b = { id: "b", updatedAt: "2026-01-01", isEnabled: false };
  assert.equal(catalogGeneration([a, b]), catalogGeneration([b, a]));
  assert.notEqual(catalogGeneration([a]), catalogGeneration([{ ...a, isEnabled: true }]));
  assert.notEqual(catalogGeneration([a]), catalogGeneration([{ ...a, updatedAt: "2026-01-02" }]));
  assert.notEqual(catalogGeneration([a]), catalogGeneration([]));
});
test("duplicate configs ignore labels, UUID case, host spelling and query ordering", () => {
  const a = candidate("a", "vless://ABCDEF@example.com.:443?security=tls&type=ws#first");
  const b = candidate("b", "vless://abcdef@EXAMPLE.COM:443?type=ws&security=tls#second");
  assert.equal(findServerDuplicates([b], [a])[0].kind, "duplicate");
  assert.equal(normalizeHost("[2001:0db8:0:0:0:0:0:1]"), "2001:db8::1");
});

test("shared endpoints and UUIDs are visible overlaps, not exact duplicates", () => {
  const a = candidate("a", "vless://abc@example.com:443?security=tls");
  assert.equal(findServerDuplicates([candidate("b", "vless://def@example.com:443?security=tls")], [a])[0].kind, "shared-endpoint");
  assert.equal(findServerDuplicates([candidate("b", "vless://abc@other.example:443?security=tls")], [a])[0].kind, "shared-credential");
  assert.equal(findServerDuplicates([a, { ...a, name: "duplicate import" }], [])[0].kind, "duplicate");
  assert.deepEqual(findServerDuplicates([{ ...a, id: "same" }], [{ ...a, id: "same" }]), []);
});

test("all 20 bilingual notices pass the actual client catalog filters without connection targets", async () => {
  const entries = legacyNoticeEntries();
  assert.equal(entries.length, 20);
  assert.equal(new Set(entries.map(entry => entry.id)).size, 20);
  assert.equal(entries.filter(entry => /[\u0600-\u06ff]/.test(entry.name)).length, 10);
  for (const platform of ["android", "app"]) {
    const source = await readFile(new URL(`../../../${platform}/src/App.tsx`, import.meta.url), "utf8");
    const filter = source.match(/const isUsableServer = \([\s\S]*?\n};/)?.[0];
    assert.ok(filter, `${platform} catalog filter must be located`);
    const javascript = ts.transpile(filter, { target: ts.ScriptTarget.ES2022 });
    const accepts = new Function(`${javascript}; return isUsableServer;`)();
    assert.equal(entries.filter(accepts).length, 20);
  }
  assert.ok(entries.every(entry => entry.runtimeProfile.supported === false && !entry.runtimeProfile.outbound && entry.host === null && entry.rawConfig === ""));
});
