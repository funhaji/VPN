import { randomBytes, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { premiumDb, ensurePremiumSchema } from "@/lib/premium-db";
import { digest, PremiumError } from "@/lib/premium-proof";
import { decryptConfig, encryptConfig } from "@/lib/crypto";
import { detectProfileMetadata } from "@/lib/profile-import";
import { buildRuntimeProfile } from "@/lib/server-catalog";

export async function premiumAccount(deviceHash: string) {
  const sql = premiumDb();
  const [device] = await sql`SELECT * FROM premium_devices WHERE device_hash = ${deviceHash}`;
  const [sub] = device?.active_subscription ? await sql`SELECT s.*,
    (SELECT COUNT(*)::int FROM premium_redemptions r WHERE r.subscription_id = s.id) AS devices
    FROM premium_subscriptions s WHERE id = ${device.active_subscription}` : [];
  // Links, not the historical claim timestamp, determine eligibility. Include
  // expired/revoked trials and a surviving active pointer as well as redemptions.
  const [linkedTrial] = await sql`SELECT s.id FROM premium_subscriptions s WHERE s.kind = 'trial'
    AND (s.id = ${device?.active_subscription ?? null} OR EXISTS (
      SELECT 1 FROM premium_redemptions r WHERE r.subscription_id = s.id AND r.device_hash = ${deviceHash}
    )) LIMIT 1`;
  const serverNow = Date.now();
  const expiresAtMs = sub?.expires_at ? new Date(sub.expires_at).getTime() : 0;
  const active = Boolean(sub && !device.blocked_at && !sub.revoked_at && expiresAtMs > serverNow && BigInt(sub.used_bytes) < BigInt(sub.traffic_limit));
  const visible = active ? sub : null;
  return {
    active, remainingMs: active ? Math.max(0, expiresAtMs - serverNow) : 0,
    trialAvailable: !device?.blocked_at && !active && !linkedTrial, blocked: Boolean(device?.blocked_at),
    revoked: Boolean(sub?.revoked_at),
    exhausted: Boolean(sub && BigInt(sub.used_bytes) >= BigInt(sub.traffic_limit)),
    reference: visible?.reference ?? null, kind: visible?.kind ?? null, totalDays: visible?.days ?? 0,
    activatedAt: visible?.activated_at ?? null, expiresAt: visible?.expires_at ?? null,
    trafficLimit: Number(visible?.traffic_limit ?? 0), usedBytes: Number(visible?.used_bytes ?? 0),
    deviceLimit: visible?.device_limit ?? 0, devices: visible?.devices ?? 0,
    supportUrl: "https://t.me/AstroVPN_Help",
  };
}

// Admin-only remedy for a device blocked by the protocol guard: clear the block and
// restore the subscription that was revoked alongside it, if it is still otherwise valid.
export async function unblockDevice(deviceHash: string) {
  const sql = premiumDb();
  return sql.begin(async tx => {
    const [device] = await tx`SELECT * FROM premium_devices WHERE device_hash = ${deviceHash} FOR UPDATE`;
    await tx`DELETE FROM premium_access_blocks WHERE device_hash = ${deviceHash}`;
    if (!device) return { ok: true, restored: false };
    await tx`UPDATE premium_devices SET blocked_at = NULL WHERE device_hash = ${deviceHash}`;
    let subscriptionId = device.active_subscription as string | null;
    if (!subscriptionId) {
      const [redemption] = await tx`SELECT r.subscription_id FROM premium_redemptions r JOIN premium_subscriptions s ON s.id = r.subscription_id
        WHERE r.device_hash = ${deviceHash} AND s.revoked_at IS NOT NULL AND s.expires_at > NOW() AND s.used_bytes < s.traffic_limit
        ORDER BY s.revoked_at DESC LIMIT 1`;
      if (redemption) {
        subscriptionId = redemption.subscription_id;
        await tx`UPDATE premium_devices SET active_subscription = ${subscriptionId} WHERE device_hash = ${deviceHash}`;
      }
    }
    if (subscriptionId) await tx`UPDATE premium_subscriptions SET revoked_at = NULL WHERE id = ${subscriptionId}`;
    await tx`INSERT INTO premium_security_logs(device_hash, subscription_id, event, detail)
      VALUES(${deviceHash}, ${subscriptionId ?? null}, 'admin_unblocked', 'Device unblocked and its subscription restored from the admin panel')`;
    return { ok: true, restored: Boolean(subscriptionId) };
  });
}

// Preserve even a legacy pointer-only trial before a non-admin operation changes
// the current plan. Logout, recovery and paid redemption must never unlink trials.
async function preserveTrialLink(tx: TransactionSql, deviceHash: string, subscriptionId: string | null) {
  if (!subscriptionId) return;
  await tx`INSERT INTO premium_redemptions(subscription_id, device_hash)
    SELECT id, ${deviceHash} FROM premium_subscriptions WHERE id = ${subscriptionId} AND kind = 'trial'
    ON CONFLICT (subscription_id, device_hash) DO NOTHING`;
}

export async function logoutPremium(deviceHash: string) {
  const sql = premiumDb();
  await sql.begin(async tx => {
    const [device] = await tx`SELECT * FROM premium_devices WHERE device_hash = ${deviceHash} FOR UPDATE`;
    await preserveTrialLink(tx, deviceHash, device?.active_subscription ?? null);
    await tx`UPDATE premium_devices SET active_subscription = NULL WHERE device_hash = ${deviceHash}`;
  });
  return { ok: true };
}

export async function redeemPremium(deviceHash: string, key: string, trial: boolean) {
  const sql = premiumDb();
  await sql.begin(async tx => {
    const [device] = await tx`SELECT * FROM premium_devices WHERE device_hash = ${deviceHash} FOR UPDATE`;
    if (!device || device.blocked_at) throw new PremiumError("Device blocked", 403);
    // Do not replace a paid entitlement with a trial.
    if (trial && device.active_subscription) {
      const [current] = await tx`SELECT * FROM premium_subscriptions WHERE id = ${device.active_subscription}`;
      if (current && !current.revoked_at && new Date(current.expires_at).getTime() > Date.now() && BigInt(current.used_bytes) < BigInt(current.traffic_limit)) throw new PremiumError("You already have active premium");
    }
    let sub;
    if (trial) {
      // The device row lock serializes concurrent claims and admin removals.
      // Do not filter by expiry: a device linked to any trial cannot claim again.
      const [linkedTrial] = await tx`SELECT s.id FROM premium_subscriptions s WHERE s.kind = 'trial'
        AND (s.id = ${device.active_subscription ?? null} OR EXISTS (
          SELECT 1 FROM premium_redemptions r WHERE r.subscription_id = s.id AND r.device_hash = ${deviceHash}
        )) LIMIT 1`;
      if (linkedTrial) throw new PremiumError("This device is already linked to a trial subscription", 409);
      const id = randomUUID();
      [sub] = await tx`INSERT INTO premium_subscriptions(id, key_hash, reference, kind, days, device_limit, traffic_limit, activated_at, expires_at)
        VALUES(${id}, ${digest(randomBytes(32).toString("hex"))}, ${`TRIAL-${randomBytes(6).toString("hex").toUpperCase()}`}, 'trial', 1, 1, 1073741824, NOW(), NOW() + INTERVAL '1 day') RETURNING *`;
      await tx`UPDATE premium_devices SET trial_claimed_at = NOW() WHERE device_hash = ${deviceHash}`;
    } else {
      if (!/^ASTRO-[A-F0-9]{48}$/.test(key)) throw new PremiumError("Invalid subscription key");
      [sub] = await tx`SELECT * FROM premium_subscriptions WHERE key_hash = ${digest(key)} AND kind = 'paid' FOR UPDATE`;
      if (!sub || sub.revoked_at || (sub.expires_at && new Date(sub.expires_at).getTime() <= Date.now()) || BigInt(sub.used_bytes) >= BigInt(sub.traffic_limit)) throw new PremiumError("Key is invalid, expired or exhausted", 403);
    }
    const [claimed] = await tx`SELECT 1 FROM premium_redemptions WHERE subscription_id = ${sub.id} AND device_hash = ${deviceHash}`;
    if (!claimed) {
      const [count] = await tx`SELECT COUNT(*)::int AS count FROM premium_redemptions WHERE subscription_id = ${sub.id}`;
      if (count.count >= sub.device_limit) throw new PremiumError("Subscription device limit reached", 403);
      await tx`INSERT INTO premium_redemptions(subscription_id, device_hash) VALUES(${sub.id}, ${deviceHash})`;
    }
    await tx`UPDATE premium_subscriptions SET activated_at = COALESCE(activated_at, NOW()), expires_at = COALESCE(expires_at, NOW() + days * INTERVAL '1 day') WHERE id = ${sub.id}`;
    await preserveTrialLink(tx, deviceHash, device.active_subscription ?? null);
    await tx`UPDATE premium_devices SET active_subscription = ${sub.id} WHERE device_hash = ${deviceHash}`;
    await tx`INSERT INTO premium_security_logs(device_hash, subscription_id, event, detail) VALUES(${deviceHash}, ${sub.id}, ${trial ? "trial_activated" : "key_redeemed"}, 'Entitlement activated; no key or configuration recorded')`;
  });
  return premiumAccount(deviceHash);
}

// Recovery: a reinstalled or logged-out device keeps its device ID, so re-bind the most
// recent subscription redeemed on this device that is still active.
export async function recoverPremium(deviceHash: string) {
  const sql = premiumDb();
  await sql.begin(async tx => {
    const [device] = await tx`SELECT * FROM premium_devices WHERE device_hash = ${deviceHash} FOR UPDATE`;
    if (!device) throw new PremiumError("No subscription found on this device ID", 404);
    if (device.blocked_at) throw new PremiumError("Device blocked", 403);
    if (device.active_subscription) {
      const [current] = await tx`SELECT * FROM premium_subscriptions WHERE id = ${device.active_subscription}`;
      if (current && !current.revoked_at && new Date(current.expires_at).getTime() > Date.now() && BigInt(current.used_bytes) < BigInt(current.traffic_limit)) {
        return; // Already active; nothing to recover.
      }
    }
    const [candidate] = await tx`SELECT s.* FROM premium_redemptions r JOIN premium_subscriptions s ON s.id = r.subscription_id
      WHERE r.device_hash = ${deviceHash} AND s.revoked_at IS NULL AND s.expires_at > NOW() AND s.used_bytes < s.traffic_limit
      ORDER BY s.expires_at DESC LIMIT 1`;
    if (!candidate) throw new PremiumError("No active subscription found on this device ID", 404);
    await preserveTrialLink(tx, deviceHash, device.active_subscription ?? null);
    await tx`UPDATE premium_devices SET active_subscription = ${candidate.id} WHERE device_hash = ${deviceHash}`;
    await tx`INSERT INTO premium_security_logs(device_hash, subscription_id, event, detail)
      VALUES(${deviceHash}, ${candidate.id}, 'subscription_recovered', 'Subscription re-bound from this device ID redemption history')`;
  });
  return premiumAccount(deviceHash);
}

// Previews are metadata-only but still authenticated: the endpoint refuses to
// respond without a valid device proof, so the premium list cannot be scraped
// anonymously. Ping targets come from the encrypted template and never include
// credentials.
export type PremiumPingTarget = { host: string; port: number };

function pingTargetFromTemplate(rawConfig: string): PremiumPingTarget | null {
  try {
    const parsed = JSON.parse(rawConfig) as Record<string, unknown>;
    const host = [parsed.server, parsed.address, parsed.host].find(v => typeof v === "string" && v.length > 0 && v.length <= 253) as string | undefined;
    const port = [parsed.server_port, parsed.port].find(v => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 65536) as number | undefined;
    if (host && port) return { host, port };
  } catch { /* Template is not JSON (for example an OpenVPN profile); no ping target. */ }
  return null;
}

// Without an active subscription the list is names and countries only: no
// server id, no ping target, nothing that identifies or reaches a node.
export async function premiumPreviews(deviceHash: string) {
  await ensurePremiumSchema();
  const sql = premiumDb();
  const rows = await sql`SELECT id, name, country, config_json FROM premium_servers WHERE enabled = TRUE ORDER BY name, id`;
  const account = await premiumAccount(deviceHash);
  return {
    serverTime: new Date().toISOString(),
    account,
    servers: rows.map(row => {
      if (!account.active) return { name: row.name, country: row.country };
      let ping: PremiumPingTarget | null = null;
      try { ping = pingTargetFromTemplate(decryptConfig(JSON.parse(row.config_json))); } catch { ping = null; }
      return { id: row.id, name: row.name, country: row.country, pingHost: ping?.host ?? null, pingPort: ping?.port ?? null };
    }),
  };
}

// Imported provider credentials are gated by entitlement here, not provisioned on
// nodes we control. Expiry bounds app-side reuse; it cannot expire the provider's
// underlying credentials or authoritatively meter traffic on third-party nodes.
export async function premiumLease(deviceHash: string, serverId: string) {
  const sql = premiumDb();
  const account = await premiumAccount(deviceHash);
  if (!account.active) throw new PremiumError("Premium expired or exhausted. Contact @AstroVPN_Help with your subscription reference.", 403);
  const [device] = await sql`SELECT active_subscription FROM premium_devices WHERE device_hash = ${deviceHash} AND blocked_at IS NULL`;
  const [server] = await sql`SELECT * FROM premium_servers WHERE id = ${serverId} AND enabled = TRUE`;
  if (!server || !device?.active_subscription) throw new PremiumError("Server unavailable", 404);
  const options = { mux: false, fragment: false, sniffing: true, allowInsecure: false, extra: {} };
  let rawConfig: string;
  let runtimeProfile: Record<string, unknown>;
  try {
    const profile = detectProfileMetadata(decryptConfig(JSON.parse(server.config_json)));
    rawConfig = profile.rawConfig;
    runtimeProfile = buildRuntimeProfile({ protocol: profile.protocol, options }, rawConfig);
  } catch {
    throw new PremiumError("Premium server profile is invalid. Contact @AstroVPN_Help.", 503, "invalid_profile");
  }
  if (runtimeProfile.supported !== true || !runtimeProfile.outbound || typeof runtimeProfile.outbound !== "object" ||
    Array.isArray(runtimeProfile.outbound) || !["xray", "xray-core", "sing-box", "xray-jumpjump"].includes(String(runtimeProfile.engine))) {
    throw new PremiumError("This premium server profile is not supported by the premium runtime. Contact @AstroVPN_Help.", 422, "unsupported_profile");
  }
  // Recheck after profile preparation to close revoke/expiry races before releasing credentials.
  const current = await premiumAccount(deviceHash);
  const [binding] = await sql`SELECT active_subscription FROM premium_devices WHERE device_hash = ${deviceHash} AND blocked_at IS NULL`;
  if (!current.active || binding?.active_subscription !== device.active_subscription || current.reference !== account.reference) throw new PremiumError("Premium no longer active", 403);
  const [enabled] = await sql`SELECT id FROM premium_servers WHERE id = ${serverId} AND enabled = TRUE`;
  if (!enabled) throw new PremiumError("Server unavailable", 403);
  // Starting the native Android service can be delayed while the app returns
  // from the background. Give a newly issued lease enough time to reach it.
  const serverNow = Date.now();
  const subscriptionRemainingMs = Math.max(0, new Date(current.expiresAt).getTime() - serverNow);
  const leaseRemainingMs = Math.min(5 * 60_000, subscriptionRemainingMs);
  const until = serverNow + leaseRemainingMs;
  if (!Number.isFinite(until) || leaseRemainingMs <= 0) throw new PremiumError("Premium no longer active", 403);
  const id = randomUUID();
  await sql`INSERT INTO premium_usage_sessions(id, device_hash, subscription_id, server_id) VALUES(${id}, ${deviceHash}, ${device.active_subscription}, ${serverId})`;
  return { id, expiresAt: new Date(until).toISOString(), leaseRemainingMs, subscriptionExpiresAt: current.expiresAt,
    subscriptionRemainingMs, rawConfig, runtimeProfile, options,
    remainingBytes: Math.max(0, current.trafficLimit - current.usedBytes) };
}

// Cumulative app-reported tunnel bytes, NOT provider-authoritative billing.
// Per-session high-water marks make retries idempotent; the subscription row
// serializes concurrent devices so increments cannot overwrite each other.
export async function reportPremiumUsage(deviceHash: string, sessionId: string, totalBytes: number) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sessionId) || !Number.isSafeInteger(totalBytes) || totalBytes < 0) throw new PremiumError("Invalid usage report", 400, "invalid_usage");
  const sql = premiumDb();
  let sessionActive = false;
  await sql.begin(async tx => {
    const [session] = await tx`SELECT * FROM premium_usage_sessions WHERE id = ${sessionId} AND device_hash = ${deviceHash} FOR UPDATE`;
    if (!session) throw new PremiumError("Unknown premium usage session", 404, "unknown_session");
    const [binding] = await tx`SELECT active_subscription FROM premium_devices WHERE device_hash = ${deviceHash} AND blocked_at IS NULL FOR UPDATE`;
    sessionActive = binding?.active_subscription === session.subscription_id;
    if (!sessionActive) return;
    const delta = BigInt(totalBytes) > BigInt(session.reported_bytes) ? BigInt(totalBytes) - BigInt(session.reported_bytes) : BigInt(0);
    await tx`UPDATE premium_subscriptions SET used_bytes = LEAST(traffic_limit, used_bytes + ${delta.toString()}::bigint),
      expires_at = CASE WHEN used_bytes + ${delta.toString()}::bigint >= traffic_limit THEN LEAST(expires_at, NOW()) ELSE expires_at END
      WHERE id = ${session.subscription_id}`;
    await tx`UPDATE premium_usage_sessions SET reported_bytes = GREATEST(reported_bytes, ${totalBytes}) WHERE id = ${sessionId}`;
  });
  const account = await premiumAccount(deviceHash);
  const [binding] = await sql`SELECT active_subscription FROM premium_devices WHERE device_hash = ${deviceHash} AND blocked_at IS NULL`;
  const [session] = await sql`SELECT subscription_id, server_id FROM premium_usage_sessions WHERE id = ${sessionId} AND device_hash = ${deviceHash}`;
  const [server] = await sql`SELECT id FROM premium_servers WHERE id = ${session.server_id} AND enabled = TRUE`;
  const active = sessionActive && account.active && binding?.active_subscription === session?.subscription_id && Boolean(server);
  return { account, expiresAt: active ? new Date(Math.min(Date.now() + 20 * 60_000, new Date(account.expiresAt).getTime())).toISOString() : null,
    subscriptionExpiresAt: active ? account.expiresAt : null,
    subscriptionRemainingMs: active ? account.remainingMs : 0,
    remainingBytes: active ? Math.max(0, account.trafficLimit - account.usedBytes) : 0 };
}

export async function issuePremium(days: number, devices: number, bytes: number) {
  const key = `ASTRO-${randomBytes(24).toString("hex").toUpperCase()}`;
  const id = randomUUID();
  const reference = `SUB-${randomBytes(6).toString("hex").toUpperCase()}`;
  await premiumDb().begin(async tx => {
    await tx`INSERT INTO premium_subscriptions(id, key_hash, reference, kind, days, device_limit, traffic_limit)
      VALUES(${id}, ${digest(key)}, ${reference}, 'paid', ${days}, ${devices}, ${bytes})`;
    await tx`INSERT INTO premium_security_logs(subscription_id, event, detail)
      VALUES(${id}, 'admin_key_issued', 'Subscription key issued; key material is not recorded')`;
  });
  return { id, reference, key };
}

export async function editPremiumSubscription(input: {
  id: string; days: number; devices: number; trafficLimit: number; usedBytes: number; expiresAt: string | null;
}) {
  const sql = premiumDb();
  if (input.usedBytes > input.trafficLimit) throw new PremiumError("Used traffic cannot exceed the traffic limit", 400, "invalid_quota");
  await sql.begin(async tx => {
    const [updated] = await tx`UPDATE premium_subscriptions SET days = ${input.days}, device_limit = ${input.devices},
      traffic_limit = ${input.trafficLimit}, used_bytes = ${input.usedBytes}, expires_at = ${input.expiresAt}
      WHERE id = ${input.id} RETURNING id`;
    if (!updated) throw new PremiumError("Subscription not found", 404);
    await tx`INSERT INTO premium_security_logs(subscription_id, event, detail)
      VALUES(${input.id}, 'admin_subscription_edited', ${`Plan, device limit, traffic allowance, usage and expiry edited from the admin panel`})`;
  });
  return { ok: true };
}

export async function rotatePremiumKey(id: string) {
  const sql = premiumDb();
  const key = `ASTRO-${randomBytes(24).toString("hex").toUpperCase()}`;
  await sql.begin(async tx => {
    const [updated] = await tx`UPDATE premium_subscriptions SET key_hash = ${digest(key)} WHERE id = ${id} RETURNING id`;
    if (!updated) throw new PremiumError("Subscription not found", 404);
    await tx`INSERT INTO premium_security_logs(subscription_id, event, detail)
      VALUES(${id}, 'admin_key_rotated', 'Subscription key rotated; previous key invalidated and new key shown once')`;
  });
  return { ok: true, key };
}

export async function removePremiumDevice(id: string, deviceHash: string) {
  const sql = premiumDb();
  return sql.begin(async tx => {
    const [device] = await tx`SELECT * FROM premium_devices WHERE device_hash = ${deviceHash} FOR UPDATE`;
    const [removed] = await tx`DELETE FROM premium_redemptions WHERE subscription_id = ${id} AND device_hash = ${deviceHash} RETURNING subscription_id`;
    if (!removed && device?.active_subscription !== id) throw new PremiumError("Device is not assigned to this subscription", 404);
    await tx`UPDATE premium_devices SET active_subscription = NULL WHERE device_hash = ${deviceHash} AND active_subscription = ${id}`;
    await tx`INSERT INTO premium_security_logs(device_hash, subscription_id, event, detail)
      VALUES(${deviceHash}, ${id}, 'admin_device_removed', 'Device removed from this subscription in the admin panel')`;
    return { ok: true };
  });
}

export async function resetDeviceTrial(deviceHash: string) {
  // Backward-compatible response for old admin clients; never erase history or links.
  const account = await premiumAccount(deviceHash);
  return { ok: true, trialAvailable: account.trialAvailable,
    message: "Trial eligibility follows subscription links. Use Remove device on each linked trial to restore eligibility." };
}

export async function savePremiumServer(input: { id?: string; name: string; country: string; node: string; rawConfig: string }) {
  const id = input.id ?? randomUUID();
  const encrypted = JSON.stringify(encryptConfig(input.rawConfig));
  await premiumDb().begin(async tx => {
    await tx`INSERT INTO premium_servers(id, name, country, controller_node, config_json)
      VALUES(${id}, ${input.name}, ${input.country}, ${input.node}, ${encrypted})
      ON CONFLICT (id) DO UPDATE SET name = ${input.name}, country = ${input.country}, controller_node = ${input.node}, config_json = ${encrypted}`;
    await tx`INSERT INTO premium_security_logs(event, detail)
      VALUES('admin_server_added', ${`Private server ${id} added; template is not recorded`})`;
  });
}
