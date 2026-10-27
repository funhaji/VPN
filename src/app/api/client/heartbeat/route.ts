import { NextRequest, NextResponse } from "next/server";
import { recordClientHeartbeat } from "@/lib/db";
import { limitRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: corsHeaders });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      deviceId?: string;
      platform?: string;
      appVersion?: string;
      osVersion?: string;
      model?: string;
    };

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400, headers: corsHeaders });
    }

    const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    const platform = typeof body.platform === "string" ? body.platform.trim().toLowerCase() : "";

    if (!deviceId || !platform) {
      return NextResponse.json({ error: "deviceId and platform are required" }, { status: 400, headers: corsHeaders });
    }

    await recordClientHeartbeat({
      deviceId,
      platform,
      appVersion: typeof body.appVersion === "string" ? body.appVersion : "1.2.1",
      osVersion: typeof body.osVersion === "string" ? body.osVersion : "",
      model: typeof body.model === "string" ? body.model : "",
    });

    return NextResponse.json({ ok: true }, { headers: corsHeaders });
  } catch (err) {
    console.warn("Heartbeat skipped due to database status:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: true }, { headers: corsHeaders });
  }
}
