import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  let androidVersion = "1.1.2";
  let windowsVersion = "1.1.1";

  try {
    const res = await fetch(
      `https://api.github.com/repos/funhaji/AstroVPN/contents/android/version.txt?ref=main&t=${Date.now()}`,
      {
        headers: {
          "User-Agent": "AstroVPN-Website",
          Accept: "application/vnd.github.v3+json",
        },
        cache: "no-store",
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
        `https://raw.githubusercontent.com/funhaji/AstroVPN/main/android/version.txt?t=${Date.now()}`,
        { cache: "no-store" }
      );
      if (rawRes.ok) {
        const txt = (await rawRes.text()).trim();
        if (txt) androidVersion = txt;
      }
    } catch {}
  }

  if (!androidVersion) {
    androidVersion = "1.1.2";
  }

  const response = NextResponse.json({
    android: androidVersion,
    windows: windowsVersion,
    apkUrl: "https://github.com/funhaji/AstroVPN/releases/download/Android/app-universal-release.apk",
    arm64Url: "https://github.com/funhaji/AstroVPN/releases/download/Android/AstroVPN-arm64-v8a.apk",
    timestamp: Date.now(),
  });

  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return response;
}
