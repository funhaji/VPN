import { unstable_cache } from "next/cache";
import { getActiveLocationsStats, listRoutingRules, PUBLIC_DATA_TAG } from "@/lib/db";

/**
 * Shared, cross-instance caches (Vercel Data Cache) for the public client API.
 * Every function instance reuses the same result instead of hitting the DB /
 * GitHub itself. Admin writes expire them immediately via PUBLIC_DATA_TAG.
 */

export const getCachedLocationStats = unstable_cache(
  () => getActiveLocationsStats(),
  ["location-stats-v1"],
  { revalidate: 120, tags: [PUBLIC_DATA_TAG] },
);

export const getCachedRoutingRules = unstable_cache(
  () => listRoutingRules(),
  ["routing-rules-v1"],
  { revalidate: 600, tags: [PUBLIC_DATA_TAG] },
);

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

export const getCachedAppVersions = unstable_cache(
  async () => {
    const defaultAndroidUrl =
      "https://raw.githubusercontent.com/funhaji/AstroVPN/main/android/version.txt";
    const defaultWindowsUrl =
      "https://raw.githubusercontent.com/funhaji/AstroVPN/main/version.txt";

    const [android, windows] = await Promise.all([
      readVersion(process.env.ANDROID_VERSION_URL?.trim() || defaultAndroidUrl, "1.2.7"),
      readVersion(process.env.WINDOWS_VERSION_URL?.trim() || defaultWindowsUrl, "1.2.2.1"),
    ]);
    return { android, windows };
  },
  ["app-versions-v2"],
  { revalidate: 300, tags: [PUBLIC_DATA_TAG] },
);

/** Long CDN caching: Vercel's CDN answers repeat requests without running a function. */
export const publicCacheHeaders = (cdnSeconds: number, browserSeconds = 30): Record<string, string> => ({
  "Cache-Control": `public, max-age=${browserSeconds}, s-maxage=${cdnSeconds}, stale-while-revalidate=86400`,
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
});
