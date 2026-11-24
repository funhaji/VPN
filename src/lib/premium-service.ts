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

export async function premiumPreviews() {
  await ensurePremiumSchema();
  return premiumDb()`SELECT id, name, country FROM premium_servers WHERE enabled = TRUE ORDER BY name, id`;
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
      VALUES(${id}, ${input.name}, ${input.country}, ${input.node}, ${encrypted})`;
    await tx`INSERT INTO premium_security_logs(event, detail)
      VALUES('admin_server_added', ${`Private server ${id} added; template is not recorded`})`;
  });
}
