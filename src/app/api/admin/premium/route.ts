import { NextRequest } from "next/server";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { ensurePremiumSchema, premiumDb } from "@/lib/premium-db";
import { issuePremium, savePremiumServer, unblockDevice } from "@/lib/premium-service";
import { PremiumError } from "@/lib/premium-proof";
import { z } from "zod";
import { BodyLimitError, readBoundedBody } from "@/lib/bounded-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
function allowed(request: NextRequest) { return limitRequest(request) && isAuthorized(request); }
export async function GET(request: NextRequest) {
  if (!allowed(request)) return Response.json({ error: "Unauthorized or rate limited" }, { status: 403, headers });
  try {
    await ensurePremiumSchema();
    const sql = premiumDb();
    const [subscriptions, servers, logs, devices] = await Promise.all([
      sql`SELECT id, reference, kind, days, device_limit, traffic_limit, used_bytes, activated_at, expires_at, revoked_at,
        (SELECT COUNT(*)::int FROM premium_redemptions WHERE subscription_id = s.id) AS devices FROM premium_subscriptions s ORDER BY created_at DESC LIMIT 200`,
      sql`SELECT id, name, country, controller_node, enabled FROM premium_servers ORDER BY name`,
      sql`SELECT l.id, l.device_hash, d.device_id, l.subscription_id, l.event, l.detail, l.created_at
        FROM premium_security_logs l LEFT JOIN premium_devices d ON d.device_hash = l.device_hash ORDER BY l.id DESC LIMIT 200`,
      sql`SELECT device_hash, device_id, platform, blocked_at FROM (
        SELECT device_hash, device_id, platform, blocked_at FROM premium_devices WHERE blocked_at IS NOT NULL
        UNION ALL
        SELECT b.device_hash, MAX(b.device_id) AS device_id, NULL AS platform, MIN(b.created_at) AS blocked_at
        FROM premium_access_blocks b WHERE b.device_hash IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM premium_devices d WHERE d.device_hash = b.device_hash AND d.blocked_at IS NOT NULL)
        GROUP BY b.device_hash
      ) blocked ORDER BY blocked_at DESC LIMIT 100`,
    ]);
    return Response.json({ subscriptions, servers, logs, devices, credentialMode: "imported" }, { headers });
  } catch { return Response.json({ error: "Premium database unavailable. Connect the main Neon database (NEON_DATABASE_URL) in Vercel env vars, or set PREMIUM_DATABASE_URL." }, { status: 503, headers }); }
}
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("issue"), days: z.number().int().min(1).max(3650), devices: z.number().int().min(1).max(100), bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  z.object({ action: z.literal("server"), name: z.string().trim().min(1).max(70), country: z.string().trim().min(1).max(80), node: z.string().regex(/^[\w.-]{1,128}$/).default("imported"), rawConfig: z.string().min(2).max(262144) }),
  z.object({ action: z.literal("revoke"), id: z.string().uuid() }),
  z.object({ action: z.literal("unrevoke"), id: z.string().uuid() }),
  z.object({ action: z.literal("toggle-server"), id: z.string().uuid(), enabled: z.boolean() }),
  z.object({ action: z.literal("unblock-device"), deviceHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
]);
export async function POST(request: NextRequest) {
  if (!allowed(request)) return Response.json({ error: "Unauthorized or rate limited" }, { status: 403, headers });
  try {
    const data = schema.safeParse(JSON.parse(await readBoundedBody(request, 300_000)));
    if (!data.success) return Response.json({ error: "Invalid premium input" }, { status: 400, headers });
    await ensurePremiumSchema();
    const input = data.data;
    if (input.action === "issue") return Response.json(await issuePremium(input.days, input.devices, input.bytes), { headers });
    if (input.action === "unblock-device") return Response.json(await unblockDevice(input.deviceHash), { headers });
    if (input.action === "server") await savePremiumServer(input);
    if (input.action === "toggle-server") await premiumDb().begin(async tx => {
      await tx`UPDATE premium_servers SET enabled = ${input.enabled} WHERE id = ${input.id}`;
      await tx`INSERT INTO premium_security_logs(event, detail)
        VALUES('admin_server_toggled', ${`Private server ${input.id} ${input.enabled ? "enabled" : "disabled"}`})`;
    });
    if (input.action === "revoke") await premiumDb().begin(async tx => {
      await tx`UPDATE premium_subscriptions SET revoked_at = NOW() WHERE id = ${input.id}`;
      await tx`INSERT INTO premium_security_logs(subscription_id, event, detail) VALUES(${input.id}, 'admin_revoked', 'Revoked from the admin panel')`;
    });
    if (input.action === "unrevoke") await premiumDb().begin(async tx => {
      const [subscription] = await tx`UPDATE premium_subscriptions SET revoked_at = NULL WHERE id = ${input.id} RETURNING id`;
      if (!subscription) throw new PremiumError("Subscription not found", 404);
      await tx`INSERT INTO premium_security_logs(subscription_id, event, detail)
        VALUES(${input.id}, 'admin_unrevoked', 'Revocation removed from the admin panel; expiry, usage and device blocks unchanged')`;
    });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof BodyLimitError) return Response.json({ error: "Request too large" }, { status: 413, headers });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON" }, { status: 400, headers });
    if (error instanceof PremiumError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Premium operation failed" }, { status: 503, headers });
  }
}
