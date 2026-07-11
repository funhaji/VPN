import { NextResponse } from "next/server";
import { listRoutingRules } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
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

    return NextResponse.json({
      ip,
      domain,
      process,
    });
  } catch {
    return NextResponse.json({ ip: [], domain: [], process: [] });
  }
}
