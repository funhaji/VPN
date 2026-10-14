import { NextResponse } from "next/server";
import { getActiveLocationsStats } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const stats = await getActiveLocationsStats();
    const response = NextResponse.json({
      ok: true,
      locations: stats.locationCount,
      servers: stats.enabledServers,
      totalServers: stats.totalServers,
      countries: stats.countries,
      updatedAt: new Date().toISOString(),
    });

    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    return response;
  } catch (err) {
    console.error("Failed to get public server stats:", err);
    return NextResponse.json(
      {
        ok: false,
        locations: 62,
        servers: 96,
        totalServers: 96,
        countries: [],
        error: err instanceof Error ? err.message : "Failed to load stats",
      },
      { status: 200 }
    );
  }
}
