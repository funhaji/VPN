import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { listServers } from "@/lib/db";
import { decryptConfig } from "@/lib/crypto";
import { findServerDuplicates } from "@/lib/server-duplicates";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const servers = (await listServers(false)).map(server => ({ ...server, rawConfig: decryptConfig(server.encryptedConfig) }));
    const matches = findServerDuplicates(servers, []);
    return NextResponse.json({ matches: matches.slice(0, 500), total: matches.length }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to inspect stored configurations" }, { status: 503 });
  }
}
