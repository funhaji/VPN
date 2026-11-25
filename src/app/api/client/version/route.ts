import { NextRequest, NextResponse } from "next/server";
import { publicDownloadPath } from "@/lib/downloads";
import { getCachedAppVersions, getCachedLocationStats, publicCacheHeaders } from "@/lib/public-cache";

export const dynamic = "force-dynamic";

type VersionPayload = Record<string, string | number>;
let memo: { data: VersionPayload; origin: string; expiresAt: number } | null = null;

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const now = Date.now();

  if (!memo || memo.expiresAt <= now || memo.origin !== origin) {
    const [versions, stats] = await Promise.all([
      getCachedAppVersions(),
      getCachedLocationStats().catch(() => null),
    ]);
    // A published empty catalog is a real zero, not a failed stats lookup.
    const locations = stats?.locationCount ?? 0;
    const servers = stats?.enabledServers ?? 0;

    memo = {
      origin,
      expiresAt: now + 60_000,
      data: {
        android: versions.android,
        windows: versions.windows,
        // Same-site links; they redirect to a short-lived signed CDN link.
        apkUrl: `${origin}${publicDownloadPath("universal")}`,
        arm64Url: `${origin}${publicDownloadPath("arm64")}`,
        armv7Url: `${origin}${publicDownloadPath("armv7")}`,
        windowsUrl: `${origin}${publicDownloadPath("windows")}`,
        locations,
        locationCount: locations,
        servers,
        serverCount: servers,
        timestamp: now,
      },
    };
  }

  return NextResponse.json(memo.data, { headers: publicCacheHeaders(300) });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: publicCacheHeaders(86400) });
}
