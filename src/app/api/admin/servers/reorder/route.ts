import { NextRequest, NextResponse } from "next/server";
import { updateServerOrders } from "@/lib/db";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const reorderSchema = z.array(
  z.object({
    id: z.string().uuid(),
    sort_order: z.number().int(),
  })
);

export async function POST(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const parsed = reorderSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    await updateServerOrders(parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}
