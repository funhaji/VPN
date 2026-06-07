import { NextRequest, NextResponse } from "next/server";
import { deleteServer, updateServerEnabled } from "@/lib/db";
import { isAuthorized, limitRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

const getId = (input: string): string | null => {
  const value = input.trim();
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: rawId } = await context.params;
  const id = getId(rawId);
  if (!id) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const body = (await request.json()) as { isEnabled?: boolean };
    if (typeof body.isEnabled !== "boolean") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    await updateServerEnabled(id, body.isEnabled);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: rawId } = await context.params;
  const id = getId(rawId);
  if (!id) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await deleteServer(id);
  return NextResponse.json({ ok: true });
}
