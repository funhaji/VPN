import { NextRequest, NextResponse } from "next/server";
import { listRoutingRules, addRoutingRules } from "@/lib/db";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function GET(request: NextRequest) {
  if (!limitRequest(request)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rules = await listRoutingRules();
  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  if (!limitRequest(request)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { rules } = body;
  if (!Array.isArray(rules)) {
    return NextResponse.json({ error: "rules must be an array" }, { status: 400 });
  }

  const existingRules = await listRoutingRules();
  const existingSet = new Set(existingRules.map(r => `${r.type}:${r.value}`));

  const crypto = globalThis.crypto;
  const toAdd = [];
  const addedSet = new Set<string>();

  for (const r of rules) {
    const key = `${r.type}:${r.value}`;
    if (!existingSet.has(key) && !addedSet.has(key)) {
      toAdd.push({
        id: crypto.randomUUID(),
        type: r.type,
        value: r.value,
      });
      addedSet.add(key);
    }
  }

  if (toAdd.length > 0) {
    await addRoutingRules(toAdd);
    revalidatePath("/api/client/routing");
  }

  return NextResponse.json({ success: true, count: toAdd.length, totalSubmitted: rules.length });
}
