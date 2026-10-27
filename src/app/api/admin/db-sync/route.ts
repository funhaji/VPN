import { NextRequest, NextResponse } from "next/server";
import {
  getDatabaseStatus,
  syncDatabases,
  type DbProvider,
  type SyncEntityOptions,
} from "@/lib/db";
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
    const status = await getDatabaseStatus();
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to query database status" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      source?: DbProvider;
      target?: DbProvider;
      options?: SyncEntityOptions;
    };

    let source = body.source;
    let target = body.target;

    if (!source || !target) {
      source = "supabase";
      target = "neon";
    }

    if (source === target) {
      target = source === "supabase" ? "neon" : "supabase";
    }

    const synced = await syncDatabases(source, target, body.options);
    return NextResponse.json({ ok: true, source, target, synced });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNeon402 = msg.includes("402") || msg.includes("quota");
    return NextResponse.json(
      {
        error: isNeon402
          ? "Neon DB is currently quota-limited (HTTP 402). Sync involving Neon cannot complete until the quota is reset."
          : msg || "Failed to sync databases",
      },
      { status: 500 },
    );
  }
}
