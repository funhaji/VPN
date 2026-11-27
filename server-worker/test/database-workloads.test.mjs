import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../../src/lib/db.ts", import.meta.url), "utf8");
function load({ supabase = true, neon = true, failDevice = false } = {}) {
  const calls = [];
  const client = provider => Object.assign(async (strings) => {
    const sql = strings.join("?"); calls.push({ provider, sql });
    if (failDevice && sql.includes("INSERT INTO client_devices")) throw new Error("offline");
    if (sql.includes("COUNT(*)")) return [{ count: provider === "neon" ? 0 : 1, max_updated: null }];
    return [];
  }, { unsafe: async () => { calls.push({ provider, sql: "DDL" }); } });
  const exports = {};
  const env = { getSupabaseUrl: () => supabase ? "postgres://supabase" : null, getNeonUrl: () => neon ? "postgres://neon" : null };
  const require = name => {
    if (name === "@neondatabase/serverless") return { neon: () => client("neon") };
    if (name === "postgres") return { default: () => client("supabase") };
    if (name === "@/lib/env") return env;
    if (name === "next/cache") return { revalidateTag() {} };
    return {};
  };
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", "process", "console", js)(require, exports, { env: {} }, { warn() {} });
  return { db: exports, calls };
}
const payload = { deviceId: "and_0123456789abcdef", platform: "android", appVersion: "1.3.0" };

test("heartbeats write only Supabase and registration reads the same authority", async () => {
  const { db, calls } = load();
  await db.recordClientHeartbeat(payload);
  await db.queryDeviceRead`SELECT 1 FROM client_devices`;
  assert.deepEqual(calls.map(c => c.provider), ["supabase", "supabase"]);
  await db.recordClientHeartbeat(payload);
  assert.equal(calls.length, 2, "successful heartbeat remains debounced");
});
test("a failed heartbeat is retryable, and registration never reads a stale replica", async () => {
  const { db, calls } = load({ failDevice: true });
  await db.recordClientHeartbeat(payload);
  await db.recordClientHeartbeat(payload);
  assert.deepEqual(calls.map(c => c.provider), ["supabase", "supabase"]);
});
test("Neon-only installations retain device support", async () => {
  const { db, calls } = load({ supabase: false });
  await db.recordClientHeartbeat(payload);
  await db.queryDeviceRead`SELECT 1 FROM client_devices`;
  assert.deepEqual(calls.map(c => c.provider), ["neon", "neon"]);
});
test("status checks do not mutate databases even when catalog counts differ", async () => {
  const { db, calls } = load();
  const status = await db.getDatabaseStatus();
  assert.notEqual(status.neon.serverCount, status.supabase.serverCount);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(c => /^\s*SELECT/.test(c.sql)));
});
test("catalog edits still mirror to both providers", async () => {
  const { db, calls } = load();
  await db.queryWrite`UPDATE vpn_servers SET name = ${"changed"}`;
  assert.deepEqual(calls.map(c => c.provider).sort(), ["neon", "supabase"]);
});
