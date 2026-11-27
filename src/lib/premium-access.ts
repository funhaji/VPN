import { isIP } from "node:net";
import { digest, PremiumError, PREMIUM_MARKER } from "@/lib/premium-proof";
import { premiumDb } from "@/lib/premium-db";
import { queryDeviceRead } from "@/lib/db";

// Application-level denylist: affects premium routes only, not public APIs.
export function premiumSourceIp(request: Request): string | null {
  // Vercel overwrites this header at ingress. Never trust a client-supplied XFF
  // on other deployments: explicitly configure the reverse proxy to overwrite it.
  const header = process.env.VERCEL ? "x-vercel-forwarded-for" : process.env.PREMIUM_TRUSTED_IP_HEADER;
  const value = header ? request.headers.get(header)?.split(",")[0]?.trim() : null;
  return value && isIP(value) ? value : null;
}

export async function blockPremiumRequest(request: Request, reason: string) {
  const device = request.headers.get("x-astro-device") || "";
  const ip = premiumSourceIp(request);
  const deviceHash = device ? digest(device) : null;
  const sql = premiumDb();
  await sql.begin(async tx => {
    if (deviceHash) {
      await tx`INSERT INTO premium_access_blocks(kind, subject_hash, device_hash, device_id, reason)
        VALUES('device', ${deviceHash}, ${deviceHash}, ${device.slice(0, 128)}, ${reason}) ON CONFLICT(kind, subject_hash) DO NOTHING`;
      await tx`UPDATE premium_devices SET blocked_at = COALESCE(blocked_at, NOW()) WHERE device_hash = ${deviceHash}`;
    }
    if (ip) {
      await tx`INSERT INTO premium_access_blocks(kind, subject_hash, device_hash, device_id, reason)
        VALUES('ip', ${digest(ip)}, ${deviceHash}, ${device.slice(0, 128) || null}, ${reason}) ON CONFLICT(kind, subject_hash) DO NOTHING`;
    }
    await tx`INSERT INTO premium_security_logs(device_hash, event, detail)
      VALUES(${deviceHash}, 'premium_access_blocked', ${reason})`;
  });
}

export async function enforcePremiumAccess(request: Request) {
  const device = request.headers.get("x-astro-device") || "";
  const platform = request.headers.get("x-astro-platform") || "";
  const ip = premiumSourceIp(request);
  const sql = premiumDb();
  const [blocked] = await sql`SELECT 1 FROM premium_access_blocks
    WHERE (kind = 'device' AND subject_hash = ${digest(device)})
       OR (kind = 'ip' AND subject_hash = ${ip ? digest(ip) : ""}) LIMIT 1`;
  if (blocked) throw new PremiumError("Premium access blocked. Contact @AstroVPN_Help.", 403, "access_blocked");

  const required = ["x-astro-device", "x-astro-platform", "x-astro-premium", "x-astro-time", "x-astro-nonce", "x-astro-key", "x-astro-signature"];
  let reason: string | null = null;
  if (required.some(header => !request.headers.get(header))) reason = "Missing required premium headers";
  else if (request.headers.get("x-astro-premium") !== PREMIUM_MARKER) reason = "Invalid premium marker";
  else if (!['android', 'windows'].includes(platform)) reason = "Invalid premium platform";
  else if (platform === "android" ? !/^and_[a-f0-9]{16}$/.test(device) : !/^[\w.:-]{8,128}$/.test(device)) reason = "Invalid premium device ID format";
  else {
    // Use the same database/read path as Active Users, even when premium has a
    // separate DB. Database failures propagate as 503, never create bans.
    const [registered] = await queryDeviceRead`SELECT 1 FROM client_devices WHERE device_id = ${device} AND platform = ${platform} LIMIT 1`;
    if (!registered) reason = "Premium device ID not registered in Active Users";
  }
  if (reason) {
    await blockPremiumRequest(request, reason);
    throw new PremiumError("Premium access blocked. Contact @AstroVPN_Help.", 403, "access_blocked");
  }
}
