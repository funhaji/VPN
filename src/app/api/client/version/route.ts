import { NextRequest, NextResponse } from "next/server";
import { publicDownloadPath } from "@/lib/downloads";
import { getActiveLocationsStats } from "@/lib/db";

export const dynamic = "force-dynamic";

async function readVersion(url: string | undefined, fallback: string): Promise<string> {
  if (!url) return fallback;
  try {
    const token = process.env.VERSION_SOURCE_TOKEN?.trim();
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github.raw",
        "User-Agent": "AstroVPN-Site/1.0",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return fallback;
    const txt = (await res.text()).trim();
    return /^\d+(\.\d+)+$/.test(txt) ? txt : fallback;
  } catch (err) {
    console.error("Failed to fetch client version:", err);
    return fallback;
  }
}

let versionCache: {
  data: any;
  expiresAt: number;
} | null = null;

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const now = Date.now();
  if (versionCache && versionCache.expiresAt > now) {
    const res = NextResponse.json(versionCache.data);
    res.headers.set("Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60");
    res.headers.set("Access-Control-Allow-Origin", "*");
    res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    return res;
  }

  // Version sources are configured via env so no repo URL lives in this
  // (public) codebase. Works with raw URLs or the GitHub contents API
  // (set VERSION_SOURCE_TOKEN for a private repo).
  const [androidVersion, windowsVersion] = await Promise.all([
    readVersion(process.env.ANDROID_VERSION_URL, "1.2.1"),
    readVersion(process.env.WINDOWS_VERSION_URL, "1.2.0.0"),
  ]);

  let locations = 62;
  let servers = 96;

  try {
    const stats = await getActiveLocationsStats();
    if (stats.locationCount > 0) {
      locations = stats.locationCount;
    }
    if (stats.enabledServers > 0) {
      servers = stats.enabledServers;
    }
  } catch {}

  const payload = {
    android: androidVersion,
    windows: windowsVersion,
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
  };

  versionCache = {
    data: payload,
    expiresAt: now + 30 * 1000,
  };

  const response = NextResponse.json(payload);
  response.headers.set("Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60");
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return response;
}
