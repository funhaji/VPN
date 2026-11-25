import { NextRequest } from "next/server";
import { authenticatePremium, digest, premiumRateLimit, PremiumError } from "@/lib/premium-proof";
import { ensurePremiumSchema, premiumDb } from "@/lib/premium-db";
import { premiumAccount, premiumLease, premiumPreviews, recoverPremium, redeemPremium } from "@/lib/premium-service";
import { BodyLimitError, readBoundedBody } from "@/lib/bounded-body";
import { blockPremiumRequest, enforcePremiumAccess, premiumSourceIp } from "@/lib/premium-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store, private", "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,x-astro-premium,x-astro-device,x-astro-time,x-astro-nonce,x-astro-key,x-astro-signature,x-astro-platform,x-astro-version",
};
export function OPTIONS() { return new Response(null, { status: 204, headers }); }
export async function GET(request: NextRequest) {
  // Premium endpoints never answer anonymous requests: no proof, no data.
  return POST(request, { params: Promise.resolve({ operation: "invalid-method" }) });
}
export async function POST(request: NextRequest, context: { params: Promise<{ operation: string }> }) {
  try {
    await ensurePremiumSchema();
    await enforcePremiumAccess(request);
    if (request.method !== "POST") {
      await blockPremiumRequest(request, "Invalid premium request method");
      throw new PremiumError("Premium access blocked", 403, "access_blocked");
    }
    // Deployment must trust only the platform's overwritten ingress IP header.
    const ip = premiumSourceIp(request) || "unknown";
    await premiumRateLimit(`ip:${digest(ip)}`, 120);
    const body = await readBoundedBody(request, 16_384);
    const { operation } = await context.params;
    const { deviceHash } = await authenticatePremium(request, body, { recover: operation === "recover" });
    let data;
    try { data = JSON.parse(body); } catch { throw new PremiumError("Invalid JSON", 400, "bad_payload"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new PremiumError("Invalid body", 400, "bad_payload");
    if (operation === "account") return Response.json(await premiumAccount(deviceHash), { headers });
    if (operation === "previews") {
      await premiumRateLimit(`previews:${deviceHash}`, 30);
      return Response.json(await premiumPreviews(deviceHash), { headers });
    }
    if (operation === "trial" || operation === "redeem") {
      if (operation === "redeem" && (typeof data.key !== "string" || !data.key.trim())) throw new PremiumError("Missing subscription key", 403, "bad_payload");
      await premiumRateLimit(`redeem:${deviceHash}`, 8);
      return Response.json(await redeemPremium(deviceHash, typeof data.key === "string" ? data.key.trim().toUpperCase() : "", operation === "trial"), { headers });
    }
    if (operation === "lease") {
      if (!(await premiumAccount(deviceHash)).active) {
        await blockPremiumRequest(request, "Premium credential request without an active bound subscription");
        throw new PremiumError("Premium access blocked", 403, "access_blocked");
      }
      if (typeof data.serverId !== "string" || !/^[a-f0-9-]{36}$/.test(data.serverId)) throw new PremiumError("Invalid server", 400, "bad_payload");
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
    if (error instanceof PremiumError && ["bad_payload", "bad_proof", "device_changed", "device_blocked", "replayed", "bad_protocol", "identity_rejected"].includes(error.code)) {
      try { await blockPremiumRequest(request, `Invalid premium authentication: ${error.code}`); }
      catch { return Response.json({ error: "Premium service unavailable" }, { status: 503, headers }); }
    }
    if (error instanceof BodyLimitError) return Response.json({ error: "Request too large", code: "body_too_large" }, { status: 413, headers });
    const known = error instanceof PremiumError;
    return Response.json({ error: known ? error.message : "Premium service unavailable", code: known ? error.code : "service_unavailable", supportUrl: "https://t.me/AstroVPN_Help" }, { status: known ? error.status : 503, headers });
  }
}
