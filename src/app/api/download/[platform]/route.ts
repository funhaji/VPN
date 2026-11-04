import { NextRequest } from "next/server";
import { downloadRedirect } from "@/lib/download-response";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  return downloadRedirect(platform);
}
