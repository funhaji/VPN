import postgres from "postgres";
import { getDatabaseUrl } from "@/lib/env";

// Security state has exactly one authority. Do not use the catalog's replica failover.
let client: ReturnType<typeof postgres> | undefined;
let ready: Promise<void> | undefined;
export function premiumDb() {
  // PREMIUM_DATABASE_URL overrides; otherwise the premium_* tables live in the
  // main Neon/Supabase database, so a separate premium database is optional.
  const fallback = (() => { try { return getDatabaseUrl(); } catch { return null; } })();
  const url = process.env.PREMIUM_DATABASE_URL?.trim() || fallback;
  if (!url) throw new Error("Premium service is not configured: set NEON_DATABASE_URL (or PREMIUM_DATABASE_URL)");
  client ??= postgres(url, { max: 5, prepare: false, connect_timeout: 5, idle_timeout: 20 });
  return client;
}

export async function ensurePremiumSchema() {
  const sql = premiumDb();
  ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS premium_subscriptions (
      id UUID PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, reference TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('paid','trial')), days INT NOT NULL CHECK(days > 0),
      device_limit INT NOT NULL CHECK(device_limit > 0), traffic_limit BIGINT NOT NULL CHECK(traffic_limit > 0),
      used_bytes BIGINT NOT NULL DEFAULT 0 CHECK(used_bytes >= 0), activated_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS premium_devices (
      device_hash TEXT PRIMARY KEY, public_key TEXT NOT NULL, platform TEXT NOT NULL,
      blocked_at TIMESTAMPTZ, trial_claimed_at TIMESTAMPTZ,
      active_subscription UUID REFERENCES premium_subscriptions(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    // Retain hashed primary keys so existing trials and subscriptions remain bound.
    // The authenticated native ID is also kept for parity with Active Users.
    await sql`ALTER TABLE premium_devices ADD COLUMN IF NOT EXISTS device_id TEXT`;
    await sql`CREATE TABLE IF NOT EXISTS premium_access_blocks (
      kind TEXT NOT NULL CHECK(kind IN ('ip','device')), subject_hash TEXT NOT NULL,
      device_hash TEXT, device_id TEXT, reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(kind, subject_hash))`;
    await sql`CREATE TABLE IF NOT EXISTS premium_redemptions (
      subscription_id UUID REFERENCES premium_subscriptions(id), device_hash TEXT REFERENCES premium_devices(device_hash),
      redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(subscription_id, device_hash))`;
    await sql`CREATE TABLE IF NOT EXISTS premium_nonces (
      device_hash TEXT NOT NULL, nonce TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY(device_hash, nonce))`;
    await sql`CREATE TABLE IF NOT EXISTS premium_request_limits (
      bucket TEXT PRIMARY KEY, window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(), hits INT NOT NULL DEFAULT 1)`;
    await sql`CREATE TABLE IF NOT EXISTS premium_servers (
      id UUID PRIMARY KEY, name VARCHAR(70) NOT NULL, country VARCHAR(80) NOT NULL,
      controller_node VARCHAR(128) NOT NULL, config_json TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS premium_security_logs (
      id BIGSERIAL PRIMARY KEY, device_hash TEXT, subscription_id UUID, event TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  })().catch(error => { ready = undefined; throw error; });
  await ready;
}
