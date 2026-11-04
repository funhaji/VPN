import { NextResponse } from "next/server";
import { getCachedLocationStats, publicCacheHeaders } from "@/lib/public-cache";

export const dynamic = "force-dynamic";

type StatsPayload = Record<string, unknown>;
let memo: { data: StatsPayload; expiresAt: number } | null = null;

export async function GET() {
  const now = Date.now();
  if (memo && memo.expiresAt > now) {
    return NextResponse.json(memo.data, { headers: publicCacheHeaders(300) });
  }

  try {
    const stats = await getCachedLocationStats();
    const data = {
      ok: true,
      locations: stats.locationCount,
      servers: stats.enabledServers,
      totalServers: stats.totalServers,
      countries: stats.countries,
      updatedAt: new Date().toISOString(),
    };
    memo = { data, expiresAt: now + 60_000 };
    return NextResponse.json(data, { headers: publicCacheHeaders(300) });
  } catch (err) {
    console.error("Failed to get public server stats:", err);
    if (memo) return NextResponse.json(memo.data, { headers: publicCacheHeaders(60) });
    return NextResponse.json(
      { ok: false, locations: 62, servers: 96, totalServers: 96, countries: [], error: "Failed to load stats" },
      { status: 200, headers: publicCacheHeaders(30, 0) },
    );
  }
}
