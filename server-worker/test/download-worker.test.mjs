import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../../download-worker/src/index.js";

function request(id) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = createHmac("sha256", "test-secret").update(`${id}.${exp}`).digest("base64url");
  return new Request(`https://downloads.example.test/${id}.${exp}.${sig}/app.apk`);
}

test("download worker rejects inherited names and refreshes source-specific cache keys", async () => {
  const originalCaches = globalThis.caches;
  const originalFetch = globalThis.fetch;
  const keys = [];
  const urls = [];
  globalThis.caches = { default: { match: async key => { keys.push(key.url); return undefined; }, put: async () => {} } };
  globalThis.fetch = async url => { urls.push(url); return new Response("binary"); };
  const pending = [];
  const ctx = { waitUntil: promise => pending.push(promise) };
  const env = release => ({ SIGNING_SECRET: "test-secret", FILES: JSON.stringify({ arm64: { filename: "app.apk", source: { type: "url", url: `https://origin.example.test/${release}.apk` } } }) });
  try {
    const invalid = await worker.fetch(request("constructor"), env("one"), ctx);
    assert.equal(invalid.status, 404);
    assert.equal(urls.length, 0);
    const first = await worker.fetch(request("arm64"), env("one"), ctx);
    assert.equal(first.status, 200);
    await first.text();
    const second = await worker.fetch(request("arm64"), env("two"), ctx);
    assert.equal(second.status, 200);
    await second.text();
    assert.deepEqual(urls, ["https://origin.example.test/one.apk", "https://origin.example.test/two.apk"]);
    assert.notEqual(keys[0], keys[1]);
    await Promise.all(pending);
  } finally {
    globalThis.caches = originalCaches;
    globalThis.fetch = originalFetch;
  }
});
