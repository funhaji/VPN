import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { deleteServer, getServer, updateServer } from "@/lib/db";
import { isAuthorized, limitRequest } from "@/lib/auth";

import { decryptConfig, encryptConfig } from "@/lib/crypto";
import { updateServerSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const revalidateServerCatalog = (): void => {
  revalidatePath("/api/servers");
};

const getId = (input: string): string | null => {
  const value = input.trim();
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
};

export async function GET(
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

  const server = await getServer(id);
  if (!server) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  
  const decryptedConfig = decryptConfig(server.encryptedConfig);

  return NextResponse.json({ server, rawConfig: decryptedConfig });
}

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
    const payload = await request.json();
    const parsed = updateServerSchema.safeParse({ ...payload, id });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const data = parsed.data;
    const updateInput: Parameters<typeof updateServer>[1] = {
      name: data.name,
      protocol: data.protocol,
      host: data.host,
      port: data.port,
      country: data.country,
      isEnabled: data.isEnabled,
      options: data.options,
    };
    if (data.rawConfig !== undefined) {
      updateInput.encryptedConfig = encryptConfig(data.rawConfig);
    }

    await updateServer(id, updateInput);
    revalidateServerCatalog();
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
  revalidateServerCatalog();
  return NextResponse.json({ ok: true });
}
