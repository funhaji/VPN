import { NextResponse } from "next/server";
import { listRoutingRules } from "@/lib/db";

// Revalidate every hour, but it can be invalidated on-demand by the admin panel
export const revalidate = 3600;

export async function GET() {
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
}
