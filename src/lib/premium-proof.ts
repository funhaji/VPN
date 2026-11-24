import { createHash, createPublicKey, verify } from "node:crypto";
import { premiumDb, ensurePremiumSchema } from "@/lib/premium-db";

export const PREMIUM_MARKER = "astro-premium-v1";
export class PremiumError extends Error {
  public status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export const digest = (value: string) => createHash("sha256").update(value).digest("base64url");

export async function premiumRateLimit(bucket: string, max: number) {
  const sql = premiumDb();
  const [row] = await sql`INSERT INTO premium_request_limits(bucket) VALUES(${bucket})
    ON CONFLICT(bucket) DO UPDATE SET
      hits = CASE WHEN premium_request_limits.window_start < NOW() - INTERVAL '1 minute' THEN 1 ELSE premium_request_limits.hits + 1 END,
      window_start = CASE WHEN premium_request_limits.window_start < NOW() - INTERVAL '1 minute' THEN NOW() ELSE premium_request_limits.window_start END
    RETURNING hits`;
  if (row.hits > max) throw new PremiumError("Too many requests. Try again shortly.", 429);
}

export async function authenticatePremium(request: Request, body: string, options?: { recover?: boolean }) {
  await ensurePremiumSchema();
  const sql = premiumDb();
  const device = request.headers.get("x-astro-device") || "";
  const time = request.headers.get("x-astro-time") || "";
  const nonce = request.headers.get("x-astro-nonce") || "";
  const key = request.headers.get("x-astro-key") || "";
  const signature = request.headers.get("x-astro-signature") || "";
  const platform = request.headers.get("x-astro-platform") || "";
  const version = request.headers.get("x-astro-version") || "";
  const marker = request.headers.get("x-astro-premium") || "";
  if (!/^[\w.:-]{8,128}$/.test(device) || !/^\d{13}$/.test(time) || Math.abs(Date.now() - Number(time)) > 60_000 ||
    !/^[A-Za-z0-9_-]{24,64}$/.test(nonce) || key.length > 1024 || !/^[A-Za-z0-9_-]{86}$/.test(signature)) {
    throw new PremiumError("Invalid device proof", 401);
  }
  const deviceHash = digest(device);
  let canonicalKey: string;
  try {
    const jwk = JSON.parse(Buffer.from(key, "base64url").toString());
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string" || jwk.d) throw new Error();
    canonicalKey = JSON.stringify({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y });
    const message = ["astro-premium-v1", request.method, new URL(request.url).pathname, device, platform, version, marker, time, nonce, digest(body)].join("\n");
    if (!verify("sha256", Buffer.from(message), { key: createPublicKey({ key: JSON.parse(canonicalKey), format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))) throw new Error();
  } catch { throw new PremiumError("Invalid device proof", 401); }
  // Only enrolled identities with the pinned key may trigger a punitive action.
  const [existing] = await sql`SELECT * FROM premium_devices WHERE device_hash = ${deviceHash}`;
  if (existing && existing.public_key !== canonicalKey) {
    // Recovery: a reinstalled app keeps its device ID but regenerates its signing key.
    // Re-pin the key only when an active subscription is bound to this device identity.
    let recovered = false;
    if (options?.recover && !existing.blocked_at) {
      const [bound] = await sql`SELECT 1 FROM premium_redemptions r JOIN premium_subscriptions s ON s.id = r.subscription_id
        WHERE r.device_hash = ${deviceHash} AND s.revoked_at IS NULL AND s.expires_at > NOW() AND s.used_bytes < s.traffic_limit`;
      if (bound) {
        await sql`UPDATE premium_devices SET public_key = ${canonicalKey} WHERE device_hash = ${deviceHash}`;
        await sql`INSERT INTO premium_security_logs(device_hash, event, detail)
          VALUES(${deviceHash}, 'device_identity_recovered', 'Signing key re-pinned after reinstall; active subscription verified on this device ID')`;
        recovered = true;
      }
    }
    if (!recovered) throw new PremiumError("Device identity changed. DM @AstroVPN_Help and send your subscription key privately. Never post it publicly.", 403);
  }
  if (existing?.blocked_at) throw new PremiumError("Device blocked. DM @AstroVPN_Help and send your subscription key privately. Never post it publicly.", 403);
  await premiumRateLimit(`device:${deviceHash}`, 90);
  // Reject captured proofs before any punitive side effects.
  const inserted = await sql`INSERT INTO premium_nonces(device_hash, nonce, expires_at) VALUES(${deviceHash}, ${nonce}, NOW() + INTERVAL '2 minutes') ON CONFLICT DO NOTHING RETURNING nonce`;
  if (!inserted.length) throw new PremiumError("Replayed request", 409);
  if (marker !== PREMIUM_MARKER || !["android", "windows"].includes(platform) || !/^\d+\.\d+\.\d+$/.test(version)) {
    if (existing) {
      await sql.begin(async tx => {
        const [current] = await tx`SELECT active_subscription FROM premium_devices WHERE device_hash = ${deviceHash} FOR UPDATE`;
        await tx`UPDATE premium_devices SET blocked_at = NOW() WHERE device_hash = ${deviceHash}`;
        if (current?.active_subscription) await tx`UPDATE premium_subscriptions SET revoked_at = NOW() WHERE id = ${current.active_subscription}`;
        await tx`INSERT INTO premium_security_logs(device_hash, subscription_id, event, detail)
          VALUES(${deviceHash}, ${current?.active_subscription ?? null}, 'authenticated_protocol_violation', 'Signed request used invalid marker, platform or app version; device blocked and subscription revoked')`;
      });
    }
    throw new PremiumError("Invalid client protocol. DM @AstroVPN_Help and send your subscription key privately. Never post it publicly.", 403);
  }
  await sql`INSERT INTO premium_devices(device_hash, public_key, platform) VALUES(${deviceHash}, ${canonicalKey}, ${platform}) ON CONFLICT DO NOTHING`;
  // Recheck after concurrent enrollment: INSERT ON CONFLICT must not authorize a different key.
  const [pinned] = await sql`SELECT * FROM premium_devices WHERE device_hash = ${deviceHash}`;
  if (pinned.public_key !== canonicalKey || pinned.blocked_at) throw new PremiumError("Device identity rejected", 403);
  await sql`DELETE FROM premium_nonces WHERE expires_at < NOW()`;
  return { deviceHash, platform };
}
