import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const digest = value => createHash("sha256").update(value).digest("base64url");
const state = { blocks: [], logs: [], registered: true, unavailable: false };
globalThis.__premiumAccessTest = {
  digest,
  PremiumError: class extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } },
  premiumDb: () => Object.assign(async (strings, ...values) => {
    const sql = strings.join("?");
    if (sql.includes("SELECT 1 FROM premium_access_blocks")) return state.blocks.some(b => b.hash === values[0] || b.hash === values[1]) ? [{}] : [];
    if (sql.includes("INSERT INTO premium_access_blocks")) state.blocks.push({ kind: sql.includes("VALUES('device'") ? "device" : "ip", hash: values[0] });
    if (sql.includes("INSERT INTO premium_security_logs")) state.logs.push(values);
    return [];
  }, { begin: async fn => fn(globalThis.__premiumAccessTest.premiumDb()) }),
  queryRead: async () => { if (state.unavailable) throw new Error("database unavailable"); return state.registered ? [{}] : []; },
};
let source = await readFile(new URL("../../src/lib/premium-access.ts", import.meta.url), "utf8");
source = source.replace(/import \{ digest, PremiumError, PREMIUM_MARKER \} from "@\/lib\/premium-proof";/,
  'const { digest, PremiumError } = globalThis.__premiumAccessTest; const PREMIUM_MARKER = "astro-premium-v1";')
  .replace(/import \{ premiumDb \} from "@\/lib\/premium-db";/, 'const { premiumDb } = globalThis.__premiumAccessTest;')
  .replace(/import \{ queryRead \} from "@\/lib\/db";/, 'const { queryRead } = globalThis.__premiumAccessTest;');
const { stripTypeScriptTypes } = await import("node:module");
const guard = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const headers = () => ({ "x-astro-device": "and_0123456789abcdef", "x-astro-platform": "android", "x-astro-premium": "astro-premium-v1",
  "x-astro-time": String(Date.now()), "x-astro-nonce": "nonce", "x-astro-key": "key", "x-astro-signature": "signature", "x-vercel-forwarded-for": "203.0.113.1" });
const request = h => new Request("https://example.com/api/premium/previews", { headers: h });
function reset() { state.blocks = []; state.logs = []; state.registered = true; state.unavailable = false; process.env.VERCEL = "1"; }

test("registered Android identity with required headers passes without bans", async () => {
  reset(); await guard.enforcePremiumAccess(request(headers())); assert.equal(state.blocks.length, 0);
});
test("missing required fields and invalid ID/marker persist both IP and device bans", async () => {
  for (const field of ["x-astro-platform", "x-astro-premium", "x-astro-time", "x-astro-nonce", "x-astro-key", "x-astro-signature"]) {
    reset(); const h = headers(); delete h[field];
    await assert.rejects(guard.enforcePremiumAccess(request(h)), error => error.code === "access_blocked");
    assert.deepEqual(state.blocks.map(b => b.kind), ["device", "ip"]);
  }
  for (const change of [{ "x-astro-device": "dev_0123456789abcdef" }, { "x-astro-premium": "wrong" }]) {
    reset(); await assert.rejects(guard.enforcePremiumAccess(request({ ...headers(), ...change })));
    assert.equal(state.blocks.length, 2);
  }
});
test("absent device still bans the source IP; unknown registered identity is banned", async () => {
  reset(); const h = headers(); delete h["x-astro-device"];
  await assert.rejects(guard.enforcePremiumAccess(request(h)));
  assert.deepEqual(state.blocks.map(b => b.kind), ["ip"]);
  reset(); state.registered = false;
  await assert.rejects(guard.enforcePremiumAccess(request(headers())));
  assert.equal(state.blocks.length, 2);
});
test("banned IP cannot bypass the guard by changing device IDs", async () => {
  reset(); await guard.blockPremiumRequest(request(headers()), "test");
  await assert.rejects(guard.enforcePremiumAccess(request({ ...headers(), "x-astro-device": "and_1111111111111111" })), error => error.code === "access_blocked");
});
test("database outages deny access without poisoning the block list", async () => {
  reset(); state.unavailable = true;
  await assert.rejects(guard.enforcePremiumAccess(request(headers())), /database unavailable/);
  assert.equal(state.blocks.length, 0);
});
test("untrusted forwarded headers cannot select an IP to ban", () => {
  reset(); delete process.env.VERCEL; delete process.env.PREMIUM_TRUSTED_IP_HEADER;
  assert.equal(guard.premiumSourceIp(request(headers())), null);
});
