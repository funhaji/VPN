import { NextResponse } from "next/server";
import { deleteRoutingRule } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { revalidatePath } from "next/cache";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const id = (await params).id;
  if (!id) {
    return NextResponse.json({ error: "Missing ID" }, { status: 400 });
  }

  await deleteRoutingRule(id);
  revalidatePath("/api/client/routing");

  return NextResponse.json({ success: true });
}
