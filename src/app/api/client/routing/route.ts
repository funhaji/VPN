import { NextResponse } from "next/server";
import { getCachedRoutingRules, publicCacheHeaders } from "@/lib/public-cache";

export const dynamic = "force-dynamic";

type RoutingPayload = { ip: string[]; domain: string[]; process: string[] };
let memo: { data: RoutingPayload; expiresAt: number } | null = null;

export async function GET() {
  const now = Date.now();
  if (memo && memo.expiresAt > now) {
    return NextResponse.json(memo.data, { headers: publicCacheHeaders(600, 60) });
  }

  try {
    const data: RoutingPayload = { ip: [], domain: [], process: [] };
    for (const r of await getCachedRoutingRules()) {
      if (r.type === "ip" || r.type === "domain" || r.type === "process") data[r.type].push(r.value);
    }
    memo = { data, expiresAt: now + 5 * 60_000 };
    return NextResponse.json(data, { headers: publicCacheHeaders(600, 60) });
  } catch {
    if (memo) return NextResponse.json(memo.data, { headers: publicCacheHeaders(60) });
    return NextResponse.json({ ip: [], domain: [], process: [] }, { headers: { "Access-Control-Allow-Origin": "*" } });
  }
}
