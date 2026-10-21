import { NextResponse } from "next/server";
import { getActiveLocationsStats } from "@/lib/db";

export const dynamic = "force-dynamic";

let statsCache: {
  data: any;
  expiresAt: number;
} | null = null;

export async function GET() {
  const now = Date.now();
  if (statsCache && statsCache.expiresAt > now) {
    const res = NextResponse.json(statsCache.data);
    res.headers.set("Cache-Control", "public, max-age=30, s-maxage=120, stale-while-revalidate=600");
    res.headers.set("Access-Control-Allow-Origin", "*");
    res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    return res;
  }

  try {
    const stats = await getActiveLocationsStats();
    const payload = {
      ok: true,
      locations: stats.locationCount,
      servers: stats.enabledServers,
      totalServers: stats.totalServers,
      countries: stats.countries,
      updatedAt: new Date().toISOString(),
    };

    statsCache = {
      data: payload,
      expiresAt: now + 60 * 1000,
    };

    const response = NextResponse.json(payload);
    response.headers.set(
      "Cache-Control",
      "public, max-age=30, s-maxage=120, stale-while-revalidate=600"
    );
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
