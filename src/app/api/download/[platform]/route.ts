import { NextRequest, NextResponse } from "next/server";
import { getDirectDownloadUrl } from "@/lib/downloads";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  if (!platform) {
    return NextResponse.json({ error: "Platform is required" }, { status: 400 });
  }

  const result = await getDirectDownloadUrl(platform);
  if (!result) {
    return NextResponse.json(
      { error: `Unsupported platform: ${platform}` },
      { status: 404 }
    );
  }

  const response = NextResponse.redirect(result.url, 302);
  response.headers.set(
    "Content-Disposition",
    `attachment; filename="${result.filename}"`
  );
  response.headers.set(
    "Cache-Control",
    "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
  );
  return response;
}
