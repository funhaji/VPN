import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

let versionCache: {
  data: any;
  expiresAt: number;
} | null = null;

export async function GET() {
  const now = Date.now();
  if (versionCache && versionCache.expiresAt > now) {
    const res = NextResponse.json(versionCache.data);
    res.headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.headers.set("Access-Control-Allow-Origin", "*");
    res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    return res;
  }

  let androidVersion = "1.2.2";
  let windowsVersion = "1.1.2";

  try {
    const res = await fetch(
      "https://api.github.com/repos/funhaji/AstroVPN/contents/android/version.txt?ref=main",
      {
        headers: {
          "User-Agent": "AstroVPN-Website",
          Accept: "application/vnd.github.v3+json",
        },
        signal: AbortSignal.timeout(3000),
      }
    );

    if (res.ok) {
      const data = await res.json();
      if (data && data.content) {
        const decoded = Buffer.from(data.content, "base64").toString("utf8").trim();
        if (decoded) {
          androidVersion = decoded;
        }
      }
    }
  } catch (err) {
    console.error("Failed to fetch android version from GitHub API:", err);
  }

  if (!androidVersion) {
    try {
      const rawRes = await fetch(
        "https://raw.githubusercontent.com/funhaji/AstroVPN/main/android/version.txt",
        { signal: AbortSignal.timeout(3000) }
      );
      if (rawRes.ok) {
        const txt = (await rawRes.text()).trim();
        if (txt) androidVersion = txt;
      }
    } catch {}
  }

  if (!androidVersion) {
    androidVersion = "1.2.2";
  }

  let locations = 62;
  let servers = 96;

  try {
    const { getActiveLocationsStats } = await import("@/lib/db");
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
    apkUrl: "https://github.com/funhaji/AstroVPN/releases/download/Android/app-universal-release.apk",
    arm64Url: "https://github.com/funhaji/AstroVPN/releases/download/Android/AstroVPN-arm64-v8a.apk",
    locations,
    locationCount: locations,
    servers,
    serverCount: servers,
    timestamp: now,
  };

  versionCache = {
    data: payload,
    expiresAt: now + 5 * 60 * 1000,
  };

  const response = NextResponse.json(payload);
  response.headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return response;
}
