interface DownloadTarget {
  url: string;
  isRelease: boolean;
  filename: string;
  contentType: string;
}

export const DOWNLOAD_TARGETS: Record<string, DownloadTarget> = {
  windows: {
    url: "https://raw.githubusercontent.com/funhaji/AstroVPN/main/Astro%20VPN_setup.exe",
    isRelease: false,
    filename: "Astro VPN_setup.exe",
    contentType: "application/octet-stream",
  },
  exe: {
    url: "https://raw.githubusercontent.com/funhaji/AstroVPN/main/Astro%20VPN_setup.exe",
    isRelease: false,
    filename: "Astro VPN_setup.exe",
    contentType: "application/octet-stream",
  },
  deb: {
    url: "https://raw.githubusercontent.com/funhaji/AstroVPN/main/linux/AstroVPN.deb",
    isRelease: false,
    filename: "AstroVPN.deb",
    contentType: "application/vnd.debian.binary-package",
  },
  rpm: {
    url: "https://raw.githubusercontent.com/funhaji/AstroVPN/main/linux/AstroVPN.rpm",
    isRelease: false,
    filename: "AstroVPN.rpm",
    contentType: "application/x-rpm",
  },
  appimage: {
    url: "https://github.com/funhaji/AstroVPN/releases/download/Main/AstroVPN.AppImage",
    isRelease: true,
    filename: "AstroVPN.AppImage",
    contentType: "application/octet-stream",
  },
  android: {
    url: "https://github.com/funhaji/AstroVPN/releases/download/Android/AstroVPN-arm64-v8a.apk",
    isRelease: true,
    filename: "AstroVPN-arm64-v8a.apk",
    contentType: "application/vnd.android.package-archive",
  },
  apk: {
    url: "https://github.com/funhaji/AstroVPN/releases/download/Android/AstroVPN-arm64-v8a.apk",
    isRelease: true,
    filename: "AstroVPN-arm64-v8a.apk",
    contentType: "application/vnd.android.package-archive",
  },
  universal: {
    url: "https://github.com/funhaji/AstroVPN/releases/download/Android/app-universal-release.apk",
    isRelease: true,
    filename: "app-universal-release.apk",
    contentType: "application/vnd.android.package-archive",
  },
  arm64: {
    url: "https://github.com/funhaji/AstroVPN/releases/download/Android/AstroVPN-arm64-v8a.apk",
    isRelease: true,
    filename: "AstroVPN-arm64-v8a.apk",
    contentType: "application/vnd.android.package-archive",
  },
  "arm64-v8a": {
    url: "https://github.com/funhaji/AstroVPN/releases/download/Android/AstroVPN-arm64-v8a.apk",
    isRelease: true,
    filename: "AstroVPN-arm64-v8a.apk",
    contentType: "application/vnd.android.package-archive",
  },
  "android-arm64": {
    url: "https://github.com/funhaji/AstroVPN/releases/download/Android/AstroVPN-arm64-v8a.apk",
    isRelease: true,
    filename: "AstroVPN-arm64-v8a.apk",
    contentType: "application/vnd.android.package-archive",
  },
};

const releaseCache = new Map<string, { resolvedUrl: string; expiresAt: number }>();

export async function getDirectDownloadUrl(
  platform: string
): Promise<{ url: string; filename: string } | null> {
  const target = DOWNLOAD_TARGETS[platform.toLowerCase()];
  if (!target) return null;

  if (!target.isRelease) {
    return { url: target.url, filename: target.filename };
  }

  // Check in-memory cache (5 min TTL)
  const cached = releaseCache.get(target.url);
  if (cached && cached.expiresAt > Date.now()) {
    return { url: cached.resolvedUrl, filename: target.filename };
  }

  try {
    const res = await fetch(target.url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
      headers: {
        "User-Agent": "AstroVPN-Site/1.0",
      },
    });

    const location = res.headers.get("location");
    if (location && res.status >= 300 && res.status < 400) {
      releaseCache.set(target.url, {
        resolvedUrl: location,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      return { url: location, filename: target.filename };
    }
  } catch (err) {
    console.error(`Failed to resolve release location for ${platform}:`, err);
  }

  // Fallback to target URL
  return { url: target.url, filename: target.filename };
}
