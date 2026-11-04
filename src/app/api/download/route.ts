import { NextRequest } from "next/server";
import { downloadRedirect } from "@/lib/download-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  return downloadRedirect(q.get("platform") || q.get("file") || q.get("target") || q.get("os"));
}
