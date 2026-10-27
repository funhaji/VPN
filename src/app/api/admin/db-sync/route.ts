import { NextRequest, NextResponse } from "next/server";
import { getDatabaseStatus, syncDatabases, type DbProvider } from "@/lib/db";
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
    };

    let source = body.source;
    let target = body.target;

    if (!source || !target) {
      const status = await getDatabaseStatus();
      const neonCount = status.neon.serverCount ?? 0;
      const supabaseCount = status.supabase.serverCount ?? 0;

      if (neonCount > supabaseCount) {
        source = "neon";
        target = "supabase";
      } else if (supabaseCount > neonCount) {
        source = "supabase";
        target = "neon";
      } else {
        source = "neon";
        target = "supabase";
      }
    }

    if (source === target) {
      return NextResponse.json(
        { error: "Source and target database providers must be different" },
        { status: 400 },
      );
    }

    const synced = await syncDatabases(source, target);
    return NextResponse.json({ ok: true, source, target, synced });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to sync databases" },
      { status: 500 },
    );
  }
}
