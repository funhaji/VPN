import { NextRequest, NextResponse } from "next/server";
import { getDirectDownloadUrl } from "@/lib/downloads";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const platform =
    searchParams.get("platform") ||
    searchParams.get("file") ||
    searchParams.get("target") ||
    searchParams.get("os");

  if (!platform) {
    return NextResponse.json(
      { error: "Platform query parameter is required (e.g. ?platform=android)" },
      { status: 400 }
    );
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
  return response;
}
