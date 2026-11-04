import { createHmac } from "node:crypto";

/**
 * Public download catalogue.
 *
 * IMPORTANT: this file intentionally contains NO origin URLs. The real file
 * locations (GitHub repo, release tags, R2 keys…) live only inside the
 * Cloudflare download worker's `FILES` secret — see `download-worker/README.md`.
 *
 * The site only ever hands out short-lived signed links to the worker, e.g.
 *   https://dl.example.com/arm64.1767225600.<sig>/AstroVPN-arm64-v8a.apk
 * so the bytes are served by Cloudflare, not by Vercel, and nothing in the
 * page, the API responses or the redirects points at GitHub.
 */

export type DownloadId =
  | "windows"
  | "arm64"
  | "armv7"
  | "universal"
  | "deb"
  | "rpm"
  | "appimage";

export const DOWNLOAD_FILES: Record<DownloadId, { filename: string }> = {
  windows: { filename: "Astro VPN_setup.exe" },
  arm64: { filename: "AstroVPN-arm64-v8a.apk" },
  armv7: { filename: "AstroVPN-armeabi-v7a.apk" },
  universal: { filename: "app-universal-release.apk" },
  deb: { filename: "AstroVPN.deb" },
  rpm: { filename: "AstroVPN.rpm" },
  appimage: { filename: "AstroVPN.AppImage" },
};

/** Every alias the old `/api/download/<platform>` routes accepted keeps working. */
const ALIASES: Record<string, DownloadId> = {
  windows: "windows",
  win: "windows",
  exe: "windows",
  android: "arm64",
  apk: "arm64",
  arm64: "arm64",
  "arm64-v8a": "arm64",
  "android-arm64": "arm64",
  v7a: "armv7",
  armv7: "armv7",
  "armeabi-v7a": "armv7",
  "android-v7a": "armv7",
  universal: "universal",
  "android-universal": "universal",
  "universal-apk": "universal",
  deb: "deb",
  rpm: "rpm",
  appimage: "appimage",
  linux: "appimage",
};

export const resolveDownloadId = (platform: string): DownloadId | null =>
  ALIASES[platform.trim().toLowerCase()] ?? null;

const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Exported for the worker's test script; keep in sync with download-worker/src/index.js */
export const signDownloadToken = (id: string, exp: number, secret: string): string =>
  b64url(createHmac("sha256", secret).update(`${id}.${exp}`).digest());

export type SignedDownload =
  | { ok: true; url: string; filename: string; expiresAt: number }
  | { ok: false; status: number; error: string };

export function createSignedDownloadUrl(platform: string): SignedDownload {
  const id = resolveDownloadId(platform);
  if (!id) return { ok: false, status: 404, error: `Unsupported platform: ${platform}` };

  const base = process.env.DOWNLOAD_BASE_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.DOWNLOAD_SIGNING_SECRET?.trim();
  if (!base || !secret) {
    // Never fall back to the origin — that would leak it.
    console.error("DOWNLOAD_BASE_URL / DOWNLOAD_SIGNING_SECRET are not configured");
    return { ok: false, status: 503, error: "Downloads are temporarily unavailable" };
  }

  const ttl = Math.max(60, Number(process.env.DOWNLOAD_LINK_TTL_SECONDS) || 6 * 60 * 60);
  // Round expiry to 5-minute buckets so the redirect can be CDN-cached briefly
  // (fewer Vercel function invocations) while each link still expires.
  const bucket = 300;
  const exp = Math.ceil((Math.floor(Date.now() / 1000) + ttl) / bucket) * bucket;
  const { filename } = DOWNLOAD_FILES[id];
  const token = `${id}.${exp}.${signDownloadToken(id, exp, secret)}`;

  return {
    ok: true,
    url: `${base}/${token}/${encodeURIComponent(filename)}`,
    filename,
    expiresAt: exp,
  };
}

/** Site-relative link used by the page and returned to the app (never the origin). */
export const publicDownloadPath = (id: DownloadId) => `/api/download/${id}`;
