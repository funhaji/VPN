import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const namingSource = (await readFile(new URL("../../src/lib/server-naming.ts", import.meta.url), "utf8"))
  .replace('import { getCountryMeta, normalizeLocationCode } from "@/lib/countries";',
    'const normalizeLocationCode = value => value === "DE" ? "DE" : "GLOBAL"; const getCountryMeta = () => ({ flag: "🇩🇪", name: "Germany" });');
const { namingServersForTier, createAutoNamer } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(namingSource)).toString("base64")}`);

test("creation naming isolates tiers and includes private premium servers without double counting mirrors", () => {
  const catalog = [
    { id: "free", name: "Germany 12", country: "DE", isPremium: false },
    { id: "mirror", name: "Germany", country: "DE", isPremium: true },
  ];
  const premium = [
    { id: "mirror", name: "Germany", country: "DE" },
    { id: "private", name: "Germany 2", country: "DE" },
  ];
  assert.equal(createAutoNamer(namingServersForTier(catalog, premium, false)).next("DE"), "🇩🇪 Germany 13");
  const namer = createAutoNamer(namingServersForTier(catalog, premium, true));
  assert.equal(namer.next("DE"), "🇩🇪 Germany 3");
  assert.equal(namer.next("DE"), "🇩🇪 Germany 4");
  assert.equal(namingServersForTier(catalog, premium, true).length, 2);
});

test("premium numbering starts at one when only free servers exist", () => {
  assert.equal(createAutoNamer(namingServersForTier([{ name: "Germany 20", country: "DE" }], [], true)).next("DE"), "🇩🇪 Germany");
});

const route = await readFile(new URL("../../src/app/api/admin/premium/route.ts", import.meta.url), "utf8");
const body = route.match(/if \(input.action === "unrevoke"\) await premiumDb\(\).begin\(async tx => \{([\s\S]*?)\n    \}\);/)?.[1];
assert.ok(body);
const unrevoke = new (Object.getPrototypeOf(async function () {}).constructor)("tx", "input", "PremiumError", body);
class PremiumError extends Error { constructor(message, status) { super(message); this.status = status; } }

test("admin unrevoke clears only revocation and records an audit event", async () => {
  const calls = [];
  await unrevoke(async (sql, ...values) => {
    calls.push({ sql: sql.join("?"), values });
    return calls.length === 1 ? [{ id: "sub" }] : [];
  }, { id: "sub" }, PremiumError);
  assert.match(calls[0].sql, /SET revoked_at = NULL/);
  assert.doesNotMatch(calls[0].sql, /SET.*(?:expires_at|used_bytes|blocked_at|active_subscription)/);
  assert.match(calls[1].sql, /admin_unrevoked/);
  assert.match(route, /z\.literal\("unrevoke"\), id: z\.string\(\)\.uuid\(\)/);
  assert.ok(route.indexOf('if (!allowed(request))', route.indexOf('export async function POST')) < route.indexOf('input.action === "unrevoke"'));
});

test("unrevoking a missing subscription returns 404 without an audit insert", async () => {
  let calls = 0;
  await assert.rejects(unrevoke(async () => { calls++; return []; }, { id: "missing" }, PremiumError), error => error.status === 404);
  assert.equal(calls, 1);
});

const service = await readFile(new URL("../../src/lib/premium-service.ts", import.meta.url), "utf8");
const accountBody = service.match(/export async function premiumAccount\(deviceHash: string\) \{([\s\S]*?)\n\}/)?.[1];
assert.ok(accountBody);
const accountFor = new (Object.getPrototypeOf(async function () {}).constructor)("premiumDb", "deviceHash", accountBody);
test("revoked subscriptions report Free state without stale quotas, slots or reference", async () => {
  const sub = { reference: "SUB-test", kind: "paid", days: 30, activated_at: new Date(), expires_at: new Date(Date.now() + 86400000),
    revoked_at: new Date(), traffic_limit: "10000", used_bytes: "1234", device_limit: 2, devices: 1 };
  const snapshot = async () => {
    let calls = 0;
    return accountFor(() => async () => ++calls === 1 ? [{ active_subscription: "sub", trial_claimed_at: new Date() }] : [sub], "device");
  };
  const revoked = await snapshot();
  assert.equal(revoked.active, false);
  assert.equal(revoked.revoked, true);
  for (const field of ["reference", "kind", "expiresAt", "activatedAt"]) assert.equal(revoked[field], null);
  for (const field of ["totalDays", "trafficLimit", "usedBytes", "deviceLimit", "devices"]) assert.equal(revoked[field], 0);
  sub.revoked_at = null;
  const restored = await snapshot();
  assert.equal(restored.active, true);
  assert.equal(restored.revoked, false);
  assert.equal(restored.reference, "SUB-test");
  assert.equal(restored.usedBytes, 1234);
});
