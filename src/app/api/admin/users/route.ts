import { NextRequest, NextResponse } from "next/server";
import { getClientAnalytics, deleteClientDevice } from "@/lib/db";
import { isAuthorized, limitRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await getClientAnalytics();
    return NextResponse.json(report);
  } catch (err) {
    console.warn("Client analytics fallback:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      {
        platforms: {
          windows: { platform: "windows", total: 0, active24h: 0, active7d: 0, active30d: 0, versions: {} },
          android: { platform: "android", total: 0, active24h: 0, active7d: 0, active30d: 0, versions: {} },
        },
        totalAll: 0,
        active24hAll: 0,
        recentDevices: [],
        updatedAt: new Date().toISOString(),
        warning: err instanceof Error ? err.message : "Database unavailable",
      },
      { status: 200 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { deviceId?: string };
    const deviceId = (body.deviceId || "").trim();
    if (!deviceId) {
      return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
    }
    await deleteClientDevice(deviceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete client device" },
      { status: 500 },
    );
  }
}
