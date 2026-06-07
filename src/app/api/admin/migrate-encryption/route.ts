import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { migrateServerEncryption } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await migrateServerEncryption();
  return NextResponse.json({ ok: true, ...result });
}
