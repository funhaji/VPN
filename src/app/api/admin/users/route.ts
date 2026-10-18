import { NextRequest, NextResponse } from "next/server";
import { getClientAnalytics } from "@/lib/db";
import { isAuthorized, limitRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await getClientAnalytics();
    return NextResponse.json(report);
  } catch (err) {
    console.error("Failed to get client analytics:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load client analytics" },
      { status: 500 },
    );
  }
}
