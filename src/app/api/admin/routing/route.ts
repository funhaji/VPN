import { NextRequest, NextResponse } from "next/server";
import { listRoutingRules, addRoutingRules, deleteRoutingRules } from "@/lib/db";
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

  const crypto = globalThis.crypto;
  const toAdd = [];
  const addedSet = new Set<string>();

  for (const r of rules) {
    if (
      !r ||
      typeof r !== "object" ||
      !["ip", "domain", "process"].includes(String(r.type)) ||
      typeof r.value !== "string" ||
      !r.value.trim()
    ) {
      return NextResponse.json({ error: "Invalid rule payload" }, { status: 400 });
    }
    const type = String(r.type);
    const value = r.value.trim();
    const key = `${type}:${value}`;
    if (!addedSet.has(key)) {
      toAdd.push({
        id: crypto.randomUUID(),
        type,
        value,
      });
      addedSet.add(key);
    }
  }

  let count = 0;
  if (toAdd.length > 0) {
    count = await addRoutingRules(toAdd);
    revalidatePath("/api/client/routing");
  }

  return NextResponse.json({ success: true, count, totalSubmitted: rules.length });
}

export async function DELETE(request: NextRequest) {
  if (!limitRequest(request)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const type = url.searchParams.get("type")?.trim();
  if (type && !["ip", "domain", "process"].includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const deleted = await deleteRoutingRules(type || undefined);
  revalidatePath("/api/client/routing");
  return NextResponse.json({ success: true, deleted });
}
