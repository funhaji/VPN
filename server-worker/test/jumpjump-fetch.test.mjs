import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString("base64")}`;
const validator = moduleUrl(await readFile(new URL("../../src/lib/jumpjump.ts", import.meta.url), "utf8"));
const source = (await readFile(new URL("../../src/lib/jumpjump-fetch.ts", import.meta.url), "utf8")).replace('"./jumpjump"', JSON.stringify(validator));
const { decryptEnvelope, encryptEnvelope, fetchJumpJump, nodeEntry, providerApi, providerOrigin } = await import(moduleUrl(source));

const group = { code: "us", name: "United States", country: "us", memberLevel: 0, param: "free" };
const node = { coreType: "xray", nodeId: "one", coreConfig: { outbounds: [
  { tag: "proxy", protocol: "vless", settings: {}, proxySettings: { tag: "relay" } },
  { tag: "relay", protocol: "trojan", settings: {} },
  { tag: "direct", protocol: "freedom" },
] } };

test("provider response decryption matches timestamp-prefixed AES CBC reference", () => {
  const value = { success: true, data: { test: 42 } };
  const responseKey = Buffer.from("p1X9E3B3auiKDN1Suya13cLduKOuhn7f");
  assert.deepEqual(JSON.parse(decryptEnvelope(encryptEnvelope(value, responseKey))), value);
  const cipher = createCipheriv("aes-256-cbc", responseKey, Buffer.alloc(16));
  const tooShort = Buffer.concat([Buffer.alloc(16), cipher.update(Buffer.from("short")), cipher.final()]);
  assert.throws(() => decryptEnvelope(tooShort));
  assert.throws(() => decryptEnvelope(Buffer.alloc(31)));
});

test("provider origins reject SSRF, redirects' destinations, userinfo and cleartext credentials", () => {
  assert.equal(providerOrigin("http://d123.cloudfront.net"), "https://d123.cloudfront.net");
  assert.equal(providerOrigin("https://cfw43op8.likemjar.surf/"), "https://cfw43op8.likemjar.surf");
  for (const url of ["http://127.0.0.1", "https://localhost", "https://evil.test", "https://d.cloudfront.net.evil.test", "https://user@d.cloudfront.net", "https://d.cloudfront.net:444", "https://d.cloudfront.net/a", "https://d.cloudfront.net/?x=1"]) {
    assert.throws(() => providerOrigin(url));
  }
});

test("node imports preserve detours/custom options and stable IDs across credential rotations", () => {
  const result = nodeEntry(group, node, 0);
  assert.equal(result.runtimeProfile.engine, "xray-jumpjump");
  assert.equal(result.country, "US");
  assert.deepEqual(result.runtimeProfile.outbound.extra_outbounds, node.coreConfig.outbounds.slice(1));
  const rotated = structuredClone(node);
  rotated.coreConfig.outbounds[0].settings = { rotated: true };
  assert.equal(nodeEntry(group, rotated, 0).id, result.id);
  assert.throws(() => nodeEntry(group, { ...node, coreType: "other" }, 0));
});

test("fetch uses a single guest identity and only memberLevel zero groups", async () => {
  const calls = [];
  const entries = await fetchJumpJump(async (endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (endpoint === "config") return { data: { appConfig: { apis: ["https://api.cloudfront.net"], routers: ["https://router.cloudfront.net"] } } };
    if (endpoint === "guestLogin") return { data: { userConfig: { authorization: "private-test-token" }, groups: { normal: { list: [group, { ...group, code: "paid", param: "paid", memberLevel: 1 }] } } } };
    assert.equal(payload.groupParam, "free");
    assert.equal(payload.authorization, "private-test-token");
    assert.equal(payload.fingerprintRawDatas, undefined);
    return { data: { nodes: [node] } };
  });
  assert.equal(entries.length, 1);
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map(c => c.payload.deviceId)).size, 1);
});

test("partial fetch failure rejects refresh instead of replacing the last complete snapshot", async () => {
  await assert.rejects(fetchJumpJump(async endpoint => {
    if (endpoint === "config") return { data: { appConfig: { apis: [], routers: [] } } };
    if (endpoint === "guestLogin") return { data: { userConfig: { authorization: "test" }, groups: { normal: { list: [group] } } } };
    throw new Error("offline");
  }), /offline/);
});

test("transport is bounded, uncached and forbids redirects; failures do not reveal credentials", async () => {
  let calls = 0;
  const api = providerApi(AbortSignal.timeout(1000), async (_url, options) => {
    calls++;
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.ok(options.body instanceof Uint8Array);
    return new Response(JSON.stringify({ success: false, errorMessage: "private credential" }));
  });
  await assert.rejects(api("guestLogin", {}, ["https://test.cloudfront.net"]), error => !error.message.includes("private credential"));
  assert.equal(calls, 1);
});
