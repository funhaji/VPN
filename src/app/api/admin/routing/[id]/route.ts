import { NextRequest, NextResponse } from "next/server";
import { deleteRoutingRule } from "@/lib/db";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!limitRequest(request)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = (await params).id;
  if (!id) {
    return NextResponse.json({ error: "Missing ID" }, { status: 400 });
  }

  await deleteRoutingRule(id);
  revalidatePath("/api/client/routing");

  return NextResponse.json({ success: true });
}
