import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const source = file => readFile(new URL(`../../src/lib/${file}.ts`, import.meta.url), "utf8");
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString("base64")}`;
const countries = moduleUrl(await source("countries"));
const naming = moduleUrl((await source("server-naming")).replace('"@/lib/countries"', JSON.stringify(countries)));
const settingsSource = (await source("jumpjump-settings")).replace(/^import .*\r?\n/gm, "");
const { nameJumpJumpServers, isJumpJumpServer } = await import(moduleUrl(`import { createAutoNamer } from ${JSON.stringify(naming)};\n${settingsSource}`));
const catalogSource = await source("server-catalog");
const compiler = catalogSource.match(/export async function compilePublicationCatalog\([\s\S]*?\r?\n\}/)[0];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const compile = new AsyncFunction("listServers", "jumpJumpEnabled", "jumpJumpSnapshot", "decryptConfig", "buildRuntimeProfile", "nameJumpJumpServers", "isJumpJumpServer", "authorizeEmpty", stripTypeScriptTypes(compiler).replace(/^export async function compilePublicationCatalog\([^)]*\) \{/, "").replace(/\}$/, ""));
const normal = { id: "normal", name: "🇺🇸 United States", country: "US", protocol: "vless", options: {}, updatedAt: "today" };
const imported = { ...normal, id: "imported", protocol: "jumpjump:vless" };
const fetched = { id: "jumpjump-one", name: "provider raw label", country: "US", protocol: "jumpjump:vless", rawConfig: "test", runtimeProfile: { supported: true, engine: "xray-jumpjump" } };
const run = (enabled, stored = [normal, imported], entries = [fetched], authorizeEmpty = false) => compile(
  async (onlyEnabled, onlyFree) => { assert.equal(onlyEnabled, true); assert.equal(onlyFree, true); return stored; },
  async () => enabled, async () => ({ servers: entries, fetchedAt: "today" }), () => "test", () => ({ supported: true }), nameJumpJumpServers, isJumpJumpServer, authorizeEmpty);

test("disabled JumpJump is absent from publication, including manually imported profiles", async () => {
  const result = await run(false);
  assert.deepEqual(result.servers.map(s => s.id), ["normal"]);
});
test("enabled JumpJump joins normal servers with automatic country naming, not provider labels", async () => {
  const result = await run(true, [normal]);
  assert.equal(result.servers.length, 2);
  assert.equal(result.servers[1].name, "🇺🇸 United States 2");
  assert.equal(result.servers[1].runtimeProfile.engine, "xray-jumpjump");
});
test("automatic provider names are deterministic, unique and isolated from premium numbering", () => {
  const entries = [{ ...fetched, id: "b" }, { ...fetched, id: "a" }];
  assert.deepEqual(nameJumpJumpServers(entries, [normal]), nameJumpJumpServers([...entries].reverse(), [normal]));
  assert.deepEqual(nameJumpJumpServers(entries, [normal]).map(s => s.name), ["🇺🇸 United States 2", "🇺🇸 United States 3"]);
});
test("older manual JumpJump imports are automatically renamed alongside fetched profiles", async () => {
  const result = await run(true, [normal, { ...imported, name: "JumpJump old provider label" }]);
  const names = result.servers.filter(isJumpJumpServer).map(server => server.name);
  assert.equal(new Set(result.servers.map(server => server.name)).size, 3);
  assert.ok(names.every(name => /^🇺🇸 United States [23]$/.test(name)));
});
test("unknown locations do not collide with existing global server names", () => {
  const names = nameJumpJumpServers([{ ...fetched, country: "GLOBAL" }, { ...fetched, id: "two", country: "GLOBAL" }], [{ ...normal, name: "🌐 Global 1" }]).map(s => s.name);
  assert.deepEqual(names, ["🌐 Global 2", "🌐 Global 3"]);
});
test("disabling the only provider still requires explicit empty publication authorization", async () => {
  await assert.rejects(run(false, [imported]), /Empty catalog/);
  assert.deepEqual(await run(false, [imported], [], true), { servers: [], allServersRemoved: true });
});

const route = await readFile(new URL("../../src/app/api/admin/jumpjump/route.ts", import.meta.url), "utf8");
const publishSource = route.match(/async function publishJumpJumpChange\(\) \{[\s\S]*?\r?\n\}/)[0];
const publishChange = new AsyncFunction("publicationStatus", "createAdapter", "jumpJumpEnabled", "compilePublicationCatalog", "isJumpJumpServer", "nameJumpJumpServers", "publishCatalog", "getAccessPolicy", stripTypeScriptTypes(publishSource).replace(/^async function publishJumpJumpChange\(\) \{/, "").replace(/\}$/, ""));
test("disable immediately publishes removal without compiling unrelated draft profiles", async () => {
  let published;
  const policy = { android: { minimumVersion: "1.3.0" } };
  await publishChange(async () => ({ generation: 7 }), () => ({ publication: async () => ({ snapshot: { servers: [normal, fetched] }, policy }) }),
    async () => false, async () => { throw Error("Invalid unrelated draft"); }, isJumpJumpServer, nameJumpJumpServers,
    async (catalog, currentPolicy, generation) => { published = { catalog, currentPolicy, generation }; }, async () => { throw Error("Must preserve policy"); });
  assert.deepEqual(published, { catalog: { servers: [normal], allServersRemoved: false }, currentPolicy: policy, generation: 7 });
});
test("enable publication preserves normal profiles and assigns provider names against published names", async () => {
  let published;
  await publishChange(async () => ({ generation: 8 }), () => ({ publication: async () => ({ snapshot: { servers: [normal] }, policy: {} }) }),
    async () => true, async () => ({ servers: [{ ...normal, name: "Unpublished draft" }, fetched] }), isJumpJumpServer, nameJumpJumpServers,
    async catalog => { published = catalog; }, async () => ({}));
  assert.deepEqual(published.servers[0], normal);
  assert.equal(published.servers[1].name, "🇺🇸 United States 2");
});

const legacySource = catalogSource.slice(catalogSource.indexOf("const filterByProtocol =")).replace('await import("@/lib/client-catalog")', '({ encryptCatalogPayload: value => value })');
const legacyFactory = new Function("getAccessPolicy", "jumpJumpEnabled", "getCatalogCacheVersion", "getSharedCatalog", "NextResponse", "legacyUpdateNotices", "isJumpJumpServer", `${stripTypeScriptTypes(legacySource).replace("export async function GET", "async function GET")}\nreturn GET;`);
const request = { nextUrl: new URL("https://example.test/api/servers") };
test("legacy encrypted and stale caches cannot show JumpJump after disable", async () => {
  let enabled = true;
  let failed = false;
  const get = legacyFactory(async () => ({ legacyEnabled: true }), async () => enabled, () => 0,
    async () => { if (failed) throw Error("Test database failure"); return { servers: [normal, fetched], provider: "test" }; },
    { json: (body, options) => ({ body, ...options }) }, () => ({}), isJumpJumpServer);
  assert.equal((await get(request)).body.servers.length, 2);
  enabled = false;
  failed = true;
  assert.equal((await get(request)).status, 500);
  failed = false;
  assert.deepEqual((await get(request)).body.servers.map(s => s.id), [normal.id]);
});
test("legacy disable of the only provider sends an explicit empty catalog", async () => {
  const get = legacyFactory(async () => ({ legacyEnabled: true }), async () => false, () => 0,
    async () => ({ servers: [fetched], provider: "test" }),
    { json: body => body }, () => ({}), isJumpJumpServer);
  assert.deepEqual(await get(request), { servers: [], allServersRemoved: true });
});
