import { NextResponse } from "next/server";
import { createSignedDownloadUrl } from "@/lib/downloads";

export function downloadRedirect(platform: string | null | undefined): NextResponse {
  if (!platform) {
    return NextResponse.json(
      { error: "Platform is required (e.g. /api/download/android)" },
      { status: 400 }
    );
  }

  const result = createSignedDownloadUrl(platform);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status, headers: { "Cache-Control": "no-store" } }
    );
  }

  const response = NextResponse.redirect(result.url, 302);
  // Cache the tiny redirect on Vercel's CDN for up to 5 minutes so a rush of
  // users doesn't invoke the function every time. The signed link stays valid
  // for hours, so a cached redirect is always still usable.
  response.headers.set("Cache-Control", "public, max-age=0, s-maxage=300");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
