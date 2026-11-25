import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const source = await readFile(new URL("../../src/lib/premium-service.ts", import.meta.url), "utf8");
const body = source.match(/export async function reportPremiumUsage\(deviceHash: string, sessionId: string, totalBytes: number\) \{([\s\S]*?)\n\}/)[1];
const js = stripTypeScriptTypes(`async function run() {${body}\n}`).replace(/^async function run\(\) \{/, "").replace(/\}\s*$/, "");
const run = new (Object.getPrototypeOf(async function(){}).constructor)("premiumDb", "premiumAccount", "PremiumError", "deviceHash", "sessionId", "totalBytes", js);
const id = "12345678-1234-1234-1234-123456789abc";
class PremiumError extends Error { constructor(message, status) { super(message); this.status = status; } }
function harness() {
  let used = 0n;
  const marks = new Map([[id, 0n], [id.replace("abc", "abd"), 0n]]);
  const sessionDevices = new Map([[id, "device"], [id.replace("abc", "abd"), "device"]]);
  let tail = Promise.resolve();
  const db = async (strings, ...args) => {
    const q = strings.join("?");
    if (q.includes("premium_usage_sessions") && q.includes("FOR UPDATE")) return marks.has(args[0]) && sessionDevices.get(args[0]) === args[1] ? [{ subscription_id: "sub", reported_bytes: marks.get(args[0]), server_id: "server" }] : [];
    if (q.includes("premium_devices") && q.includes("FOR UPDATE")) return [{ active_subscription: "sub" }];
    if (q.includes("UPDATE premium_subscriptions")) { used = used + BigInt(args[0]); if (used > 1000n) used = 1000n; return []; }
    if (q.includes("UPDATE premium_usage_sessions")) { marks.set(args[1], marks.get(args[1]) > BigInt(args[0]) ? marks.get(args[1]) : BigInt(args[0])); return []; }
    if (q.includes("premium_devices")) return [{ active_subscription: "sub" }];
    if (q.includes("premium_usage_sessions")) return [{ subscription_id: "sub", server_id: "server" }];
    if (q.includes("premium_servers")) return [{ id: "server" }];
    throw new Error(q);
  };
  db.begin = fn => { const next = tail.then(() => fn(db)); tail = next.catch(() => {}); return next; };
  return {
    bind: (session, device) => sessionDevices.set(session, device),
    report: (total, session = id, device = "device") => run(() => db, async () => ({ active: used < 1000n, trafficLimit: 1000, usedBytes: Number(used), expiresAt: new Date(Date.now() + 3600000).toISOString() }), PremiumError, device, session, total),
    get used() { return used; },
  };
}
test("cumulative usage retries and out-of-order reports never double-charge", async () => {
  const h = harness();
  for (const bytes of [100, 100, 50, 350]) await h.report(bytes);
  assert.equal(h.used, 350n);
});
test("concurrent accounting sessions aggregate and exhausted quota denies renewal", async () => {
  const h = harness();
  h.bind(id, "device-a");
  h.bind(id.replace("abc", "abd"), "device-b");
  await Promise.all([h.report(400, id, "device-a"), h.report(400, id.replace("abc", "abd"), "device-b")]);
  assert.equal(h.used, 800n);
  const receipt = await h.report(900, id, "device-a");
  assert.equal(h.used, 1000n);
  assert.equal(receipt.remainingBytes, 0);
  assert.equal(receipt.expiresAt, null);
});
test("invalid totals and another device's session cannot change usage", async () => {
  const h = harness();
  for (const total of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(h.report(total));
  await assert.rejects(h.report(100, id, "other"));
  assert.equal(h.used, 0n);
  assert.match(body, /expires_at = CASE WHEN used_bytes/);
  assert.match(body, /FOR UPDATE/);
});
