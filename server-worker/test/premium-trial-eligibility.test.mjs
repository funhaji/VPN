import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";

// Execute the actual service functions against an isolated in-memory SQL double.
// No environment, database client, HTTP request or production data is loaded.
const source = await readFile(new URL("../../src/lib/premium-service.ts", import.meta.url), "utf8");
const names = ["preserveTrialLink", "premiumAccount", "redeemPremium", "recoverPremium", "logoutPremium", "resetDeviceTrial", "removePremiumDevice"];
const functions = names.map(name => {
  const match = source.match(new RegExp(`(?:export )?async function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, name);
  return match[0].replace("export ", "");
}).join("\n");
class PremiumError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const load = new Function("premiumDb", "PremiumError", "randomUUID", "randomBytes", "digest",
  `${stripTypeScriptTypes(functions)}\nreturn { ${names.join(", ")} };`);

function harness({ linked = false, pointer = linked, blocked = false, stamp = true, kind = "trial", expired = false, revoked = false, exhausted = false } = {}) {
  const device = { active_subscription: pointer ? "old" : null, blocked_at: blocked ? new Date() : null,
    trial_claimed_at: stamp ? new Date() : null };
  const subscriptions = new Map([["old", { id: "old", kind, expires_at: new Date(Date.now() + (expired ? -1 : 1) * 86400000),
    revoked_at: revoked ? new Date() : null, used_bytes: exhausted ? "1024" : "0", traffic_limit: "1024", device_limit: 1 }]]);
  const links = new Set(linked ? ["old"] : []);
  const queries = [];
  let creates = 0;
  const sql = async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(query);
    if (query.startsWith("SELECT s.id FROM premium_subscriptions")) {
      assert.match(query, /s.kind = 'trial'/);
      assert.match(query, /EXISTS.*premium_redemptions.*device_hash/);
      assert.doesNotMatch(query, /expires_at|revoked_at|trial_claimed_at/);
      return [...subscriptions.values()].filter(sub => sub.kind === "trial" && (sub.id === values[0] || links.has(sub.id))).slice(0, 1);
    }
    if (query.startsWith("SELECT * FROM premium_devices") || query.startsWith("SELECT device_hash FROM premium_devices")) return [device];
    if (query.startsWith("SELECT s.* FROM premium_redemptions")) return [...subscriptions.values()].filter(sub => links.has(sub.id) && !sub.revoked_at && sub.expires_at > new Date() && BigInt(sub.used_bytes) < BigInt(sub.traffic_limit)).slice(0, 1);
    if (query.startsWith("SELECT * FROM premium_subscriptions WHERE key_hash")) return [...subscriptions.values()].filter(sub => sub.key_hash === values[0] && sub.kind === "paid");
    if (query.startsWith("SELECT s.*") || query.startsWith("SELECT * FROM premium_subscriptions")) return subscriptions.has(values[0]) ? [subscriptions.get(values[0])] : [];
    if (query.startsWith("INSERT INTO premium_subscriptions")) {
      creates++;
      const sub = { id: values[0], kind: "trial", expires_at: new Date(Date.now() + 86400000), used_bytes: "0", traffic_limit: "1073741824", device_limit: 1 };
      subscriptions.set(sub.id, sub);
      return [sub];
    }
    if (query.startsWith("UPDATE premium_devices SET trial_claimed_at")) { device.trial_claimed_at = new Date(); return []; }
    if (query.startsWith("SELECT 1 FROM premium_redemptions")) return links.has(values[0]) ? [{}] : [];
    if (query.startsWith("SELECT COUNT(*)")) return [{ count: links.has(values[0]) ? 1 : 0 }];
    if (query.startsWith("INSERT INTO premium_redemptions")) {
      if (query.includes("SELECT id")) { if (subscriptions.get(values[1])?.kind === "trial") links.add(values[1]); }
      else links.add(values[0]);
      return [];
    }
    if (query.startsWith("UPDATE premium_subscriptions") || query.startsWith("INSERT INTO premium_security_logs")) return [];
    if (query.startsWith("UPDATE premium_devices SET active_subscription = NULL")) { if (values.length === 1 || device.active_subscription === values[1]) device.active_subscription = null; return []; }
    if (query.startsWith("UPDATE premium_devices SET active_subscription")) { device.active_subscription = values[0]; return []; }
    if (query.startsWith("DELETE FROM premium_redemptions")) return links.delete(values[0]) ? [{ subscription_id: values[0] }] : [];
    throw new Error(`Unexpected SQL: ${query}`);
  };
  // Model the per-device FOR UPDATE serialization (not a substitute for a real
  // PostgreSQL integration test); queued calls execute the real claim logic.
  let queue = Promise.resolve();
  sql.begin = fn => {
    const next = queue.then(() => fn(sql));
    queue = next.catch(() => {});
    return next;
  };
  return { ...load(() => sql, PremiumError, randomUUID, randomBytes, value => value), device, links, queries, subscriptions,
    get creates() { return creates; } };
}

test("historical trial timestamp without any trial link does not block offering or claiming", async () => {
  const h = harness();
  assert.equal((await h.premiumAccount("device")).trialAvailable, true);
  assert.equal((await h.redeemPremium("device", "", true)).active, true);
  assert.equal(h.creates, 1);
  assert.equal((await h.premiumAccount("device")).trialAvailable, false);
});

for (const state of [{}, { expired: true }, { revoked: true }, { exhausted: true }]) {
  test(`a linked trial blocks another claim regardless of state: ${JSON.stringify(state)}`, async () => {
    const h = harness({ linked: true, pointer: false, stamp: false, ...state });
    assert.equal((await h.premiumAccount("device")).trialAvailable, false);
    await assert.rejects(h.redeemPremium("device", "", true), error => error.status === 409);
    assert.equal(h.creates, 0);
  });
}

test("a surviving pointer to an expired trial is also a link", async () => {
  const h = harness({ pointer: true, expired: true, stamp: false });
  assert.equal((await h.premiumAccount("device")).trialAvailable, false);
  await assert.rejects(h.redeemPremium("device", "", true), error => error.status === 409);
});

test("admin removal restores eligibility and permits a new claim without resetting history", async () => {
  const h = harness({ linked: true, expired: true });
  await h.removePremiumDevice("old", "device");
  assert.ok(h.device.trial_claimed_at);
  assert.equal(h.device.active_subscription, null);
  assert.equal((await h.premiumAccount("device")).trialAvailable, true);
  await h.redeemPremium("device", "", true);
  assert.equal(h.creates, 1);
  const deletion = h.queries.findIndex(query => query.startsWith("DELETE FROM"));
  assert.match(h.queries[deletion - 1], /premium_devices.*FOR UPDATE/);
});

test("removing another subscription does not erase a remaining trial link", async () => {
  const h = harness({ linked: true, pointer: false });
  h.links.add("other");
  await h.removePremiumDevice("other", "device");
  assert.equal((await h.premiumAccount("device")).trialAvailable, false);
});

test("blocked devices and active paid subscriptions cannot claim trials", async () => {
  for (const options of [{ blocked: true }, { kind: "paid", pointer: true }]) {
    const h = harness(options);
    assert.equal((await h.premiumAccount("device")).trialAvailable, false);
    await assert.rejects(h.redeemPremium("device", "", true), PremiumError);
    assert.equal(h.creates, 0);
  }
});

test("an expired paid subscription is not a trial link", async () => {
  const h = harness({ kind: "paid", pointer: true, linked: true, expired: true });
  assert.equal((await h.premiumAccount("device")).trialAvailable, true);
  await h.redeemPremium("device", "", true);
  assert.equal(h.creates, 1);
});

test("concurrent claims under the device lock create only one trial", async () => {
  const h = harness();
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => h.redeemPremium("device", "", true)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(h.creates, 1);
  assert.ok(h.queries.some(query => /SELECT \* FROM premium_devices.*FOR UPDATE/.test(query)));
});

for (const linked of [true, false]) {
  test(`logout preserves trial links including legacy pointer-only records: linked=${linked}`, async () => {
    const h = harness({ linked, pointer: true, expired: true });
    await h.logoutPremium("device");
    assert.equal(h.device.active_subscription, null);
    assert.ok(h.links.has("old"));
    assert.equal((await h.premiumAccount("device")).trialAvailable, false);
    await assert.rejects(h.redeemPremium("device", "", true), error => error.status === 409);
    assert.ok(!h.queries.some(query => query.startsWith("DELETE")));
  });
}

test("only explicit admin removal clears a legacy pointer-only trial", async () => {
  const h = harness({ pointer: true, expired: true });
  await h.removePremiumDevice("old", "device");
  assert.equal((await h.premiumAccount("device")).trialAvailable, true);
});

test("legacy reset action cannot override a trial link or erase claim history", async () => {
  const h = harness({ linked: true, expired: true });
  const stamp = h.device.trial_claimed_at;
  assert.equal((await h.resetDeviceTrial("device")).trialAvailable, false);
  assert.equal(h.device.trial_claimed_at, stamp);
  assert.ok(h.links.has("old"));
  assert.ok(h.queries.every(query => query.startsWith("SELECT")));
});

for (const operation of ["redeem", "recover"]) {
  test(`${operation} preserves legacy trial association when switching to paid premium`, async () => {
    const h = harness({ pointer: true, expired: true });
    const key = `ASTRO-${"A".repeat(48)}`;
    h.subscriptions.set("paid", { id: "paid", key_hash: key, kind: "paid", expires_at: new Date(Date.now() + 86400000), used_bytes: "0", traffic_limit: "1024", device_limit: 2 });
    if (operation === "recover") { h.links.add("paid"); await h.recoverPremium("device"); }
    else await h.redeemPremium("device", key, false);
    assert.equal(h.device.active_subscription, "paid");
    assert.ok(h.links.has("old"));
    await h.logoutPremium("device");
    assert.equal((await h.premiumAccount("device")).trialAvailable, false);
  });
}
