import test from "node:test";
import assert from "node:assert/strict";
import { resolveDownloadId, createSignedDownloadUrl } from "../../src/lib/downloads.ts";

test("download aliases reject inherited Object properties instead of crashing", () => {
  for (const value of ["constructor", "__proto__", "toString", "valueOf", "unsupported"]) {
    assert.equal(resolveDownloadId(value), null);
    assert.equal(createSignedDownloadUrl(value).status, 404);
  }
  assert.equal(resolveDownloadId(" Android "), "arm64");
  assert.equal(resolveDownloadId("universal"), "universal");
});

test("signed downloads always outlive a cached redirect, including short configured TTLs", () => {
  const original = { ...process.env };
  try {
    process.env.DOWNLOAD_BASE_URL = "https://downloads.example.test";
    process.env.DOWNLOAD_SIGNING_SECRET = "test-secret";
    for (const ttl of ["60", "1", "Infinity", "NaN", "-100", "21600"]) {
      process.env.DOWNLOAD_LINK_TTL_SECONDS = ttl;
      const now = Math.floor(Date.now() / 1000);
      const result = createSignedDownloadUrl("android");
      assert.equal(result.ok, true);
      assert.ok(Number.isFinite(result.expiresAt));
      assert.ok(result.expiresAt - now >= 360, ttl);
      assert.match(result.url, /^https:\/\/downloads\.example\.test\/arm64\.\d+\.[\w-]+\//);
    }
  } finally {
    for (const key of ["DOWNLOAD_BASE_URL", "DOWNLOAD_SIGNING_SECRET", "DOWNLOAD_LINK_TTL_SECONDS"]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
