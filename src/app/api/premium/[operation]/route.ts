import { NextRequest } from "next/server";
import { authenticatePremium, digest, premiumRateLimit, PremiumError } from "@/lib/premium-proof";
import { ensurePremiumSchema, premiumDb } from "@/lib/premium-db";
import { premiumAccount, premiumLease, premiumPreviews, recoverPremium, redeemPremium } from "@/lib/premium-service";
import { BodyLimitError, readBoundedBody } from "@/lib/bounded-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store, private", "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,x-astro-premium,x-astro-device,x-astro-time,x-astro-nonce,x-astro-key,x-astro-signature,x-astro-platform,x-astro-version",
};
export function OPTIONS() { return new Response(null, { status: 204, headers }); }
export async function GET(_request: Request, context: { params: Promise<{ operation: string }> }) {
  if ((await context.params).operation !== "previews") return Response.json({ error: "Not found" }, { status: 404, headers });
  try { return Response.json({ servers: await premiumPreviews() }, { headers }); }
  catch { return Response.json({ error: "Premium unavailable" }, { status: 503, headers }); }
}
export async function POST(request: NextRequest, context: { params: Promise<{ operation: string }> }) {
  try {
    await ensurePremiumSchema();
    // Deployment must trust only the platform's overwritten ingress IP header.
    const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    await premiumRateLimit(`ip:${digest(ip)}`, 120);
    const body = await readBoundedBody(request, 16_384);
    const { operation } = await context.params;
    const { deviceHash } = await authenticatePremium(request, body, { recover: operation === "recover" });
    let data;
    try { data = JSON.parse(body); } catch { throw new PremiumError("Invalid JSON"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new PremiumError("Invalid body");
    if (operation === "account") return Response.json(await premiumAccount(deviceHash), { headers });
    if (operation === "trial" || operation === "redeem") {
      await premiumRateLimit(`redeem:${deviceHash}`, 8);
      return Response.json(await redeemPremium(deviceHash, typeof data.key === "string" ? data.key.trim().toUpperCase() : "", operation === "trial"), { headers });
    }
    if (operation === "lease") {
      if (typeof data.serverId !== "string" || !/^[a-f0-9-]{36}$/.test(data.serverId)) throw new PremiumError("Invalid server");
      return Response.json(await premiumLease(deviceHash, data.serverId), { headers });
    }
    if (operation === "recover") {
      await premiumRateLimit(`recover:${deviceHash}`, 8);
      return Response.json(await recoverPremium(deviceHash), { headers });
    }
    if (operation === "logout") {
      await premiumDb()`UPDATE premium_devices SET active_subscription = NULL WHERE device_hash = ${deviceHash}`;
      return Response.json({ ok: true }, { headers });
    }
    throw new PremiumError("Not found", 404);
  } catch (error) {
    if (error instanceof BodyLimitError) return Response.json({ error: "Request too large" }, { status: 413, headers });
    const known = error instanceof PremiumError;
    return Response.json({ error: known ? error.message : "Premium service unavailable", supportUrl: "https://t.me/AstroVPN_Help" }, { status: known ? error.status : 503, headers });
  }
}
