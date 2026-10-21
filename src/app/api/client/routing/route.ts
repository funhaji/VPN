import { NextResponse } from "next/server";
import { listRoutingRules } from "@/lib/db";

export const dynamic = "force-dynamic";

let routingCache: {
  data: { ip: string[]; domain: string[]; process: string[] };
  expiresAt: number;
} | null = null;

export async function GET() {
  const now = Date.now();
  if (routingCache && routingCache.expiresAt > now) {
    const res = NextResponse.json(routingCache.data);
    res.headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.headers.set("Access-Control-Allow-Origin", "*");
    res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    return res;
  }

  try {
    const rulesList = await listRoutingRules();

    const ip: string[] = [];
    const domain: string[] = [];
    const process: string[] = [];

    for (const r of rulesList) {
      if (r.type === "ip") ip.push(r.value);
      if (r.type === "domain") domain.push(r.value);
      if (r.type === "process") process.push(r.value);
    }

    const payload = { ip, domain, process };
    routingCache = {
      data: payload,
      expiresAt: now + 5 * 60 * 1000,
    };

    const res = NextResponse.json(payload);
    res.headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.headers.set("Access-Control-Allow-Origin", "*");
    res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    return res;
  } catch {
    const res = NextResponse.json({ ip: [], domain: [], process: [] });
    res.headers.set("Access-Control-Allow-Origin", "*");
    return res;
  }
}
