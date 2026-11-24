import { randomBytes, randomUUID } from "node:crypto";
import { premiumDb, ensurePremiumSchema } from "@/lib/premium-db";
import { digest, PremiumError } from "@/lib/premium-proof";
import { decryptConfig, encryptConfig } from "@/lib/crypto";
import { readBoundedBody } from "@/lib/bounded-body";

export async function premiumAccount(deviceHash: string) {
  const sql = premiumDb();
  const [device] = await sql`SELECT * FROM premium_devices WHERE device_hash = ${deviceHash}`;
  const [sub] = device?.active_subscription ? await sql`SELECT s.*,
    (SELECT COUNT(*)::int FROM premium_redemptions r WHERE r.subscription_id = s.id) AS devices
    FROM premium_subscriptions s WHERE id = ${device.active_subscription}` : [];
  const active = Boolean(sub && !device.blocked_at && !sub.revoked_at && sub.expires_at && new Date(sub.expires_at).getTime() > Date.now() && BigInt(sub.used_bytes) < BigInt(sub.traffic_limit));
  return {
    active, trialAvailable: !device?.trial_claimed_at, blocked: Boolean(device?.blocked_at),
    reference: sub?.reference ?? null, kind: sub?.kind ?? null, totalDays: sub?.days ?? 0,
    activatedAt: sub?.activated_at ?? null, expiresAt: sub?.expires_at ?? null,
    trafficLimit: Number(sub?.traffic_limit ?? 0), usedBytes: Number(sub?.used_bytes ?? 0),
    deviceLimit: sub?.device_limit ?? 0, devices: sub?.devices ?? 0,
    supportUrl: "https://t.me/AstroVPN_Help",
  };
}

// Admin-only remedy for a device blocked by the protocol guard: clear the block and
// restore the subscription that was revoked alongside it, if it is still otherwise valid.
export async function unblockDevice(deviceHash: string) {
  const sql = premiumDb();
  return sql.begin(async tx => {
    const [device] = await tx`SELECT * FROM premium_devices WHERE device_hash = ${deviceHash} FOR UPDATE`;
    if (!device) throw new PremiumError("Device not found", 404);
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
      if (device.trial_claimed_at) throw new PremiumError("This device has already used its one-time trial", 409);
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

// A node controller, not a client-supplied byte counter, is the traffic authority.
// Its lease endpoint must verify this subscription against the same authoritative DB.
export async function premiumLease(deviceHash: string, serverId: string) {
  const sql = premiumDb();
  const account = await premiumAccount(deviceHash);
  if (!account.active) throw new PremiumError("Premium expired or exhausted. Contact @AstroVPN_Help with your subscription reference.", 403);
  const controller = process.env.PREMIUM_CONTROLLER_URL;
  const token = process.env.PREMIUM_CONTROLLER_TOKEN;
  if (!controller || !token || new URL(controller).protocol !== "https:") throw new PremiumError("Premium node enforcement is not configured. Contact @AstroVPN_Help.", 503);
  const [device] = await sql`SELECT active_subscription FROM premium_devices WHERE device_hash = ${deviceHash} AND blocked_at IS NULL`;
  const [server] = await sql`SELECT * FROM premium_servers WHERE id = ${serverId} AND enabled = TRUE`;
  if (!server || !device) throw new PremiumError("Server unavailable", 404);
  const response = await fetch(new URL("/v1/leases", controller), {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceHash, subscriptionId: device.active_subscription, serverId, node: server.controller_node,
      template: decryptConfig(JSON.parse(server.config_json)), maxLeaseSeconds: 60 }),
  });
  if (!response.ok) throw new PremiumError("Premium node refused the connection", 503);
  let lease;
  try { lease = JSON.parse(await readBoundedBody(response, 524_288)); }
  catch { throw new PremiumError("Invalid premium node response", 503); }
  const until = new Date(lease?.expiresAt).getTime();
  if (!lease || typeof lease.id !== "string" || lease.id.length < 1 || lease.id.length > 128 ||
    typeof lease.rawConfig !== "string" || lease.rawConfig.length < 2 ||
    !lease.runtimeProfile?.outbound || typeof lease.runtimeProfile.outbound !== "object" || Array.isArray(lease.runtimeProfile.outbound) ||
    lease.runtimeProfile.supported !== true || !["xray-core", "sing-box", "xray-jumpjump"].includes(lease.runtimeProfile.engine) ||
    !Number.isFinite(until) || until <= Date.now() || until > Math.min(Date.now() + 60_000, new Date(account.expiresAt).getTime())) throw new PremiumError("Invalid premium node lease", 503);
  // Recheck after provisioning to close revoke/expiry races before releasing credentials.
  const current = await premiumAccount(deviceHash);
  const [binding] = await sql`SELECT active_subscription FROM premium_devices WHERE device_hash = ${deviceHash} AND blocked_at IS NULL`;
  if (!current.active || binding?.active_subscription !== device.active_subscription || current.reference !== account.reference) throw new PremiumError("Premium no longer active", 403);
  const [enabled] = await sql`SELECT id FROM premium_servers WHERE id = ${serverId} AND enabled = TRUE`;
  if (!enabled) throw new PremiumError("Server unavailable", 403);
  return { id: lease.id, expiresAt: lease.expiresAt, rawConfig: lease.rawConfig, runtimeProfile: lease.runtimeProfile,
    options: { mux: false, fragment: false, sniffing: true, allowInsecure: false, extra: {} } };
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
