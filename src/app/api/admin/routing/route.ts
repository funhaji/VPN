import { NextResponse } from "next/server";
import { listRoutingRules, addRoutingRules, deleteRoutingRule } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { revalidatePath } from "next/cache";

export async function GET() {
  await requireSession();
  const rules = await listRoutingRules();
  return NextResponse.json({ rules });
}

export async function POST(req: Request) {
  await requireSession();
  const body = await req.json();
  const { rules } = body;
  if (!Array.isArray(rules)) {
    return NextResponse.json({ error: "rules must be an array" }, { status: 400 });
  }

  const crypto = globalThis.crypto;
  const toAdd = rules.map((r: { type: string; value: string }) => ({
    id: crypto.randomUUID(),
    type: r.type,
    value: r.value,
  }));

  if (toAdd.length > 0) {
    await addRoutingRules(toAdd);
    revalidatePath("/api/client/routing");
  }

  return NextResponse.json({ success: true, count: toAdd.length });
}
