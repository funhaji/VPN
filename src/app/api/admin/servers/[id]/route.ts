import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { deleteServer, getServer, updateServer } from "@/lib/db";
import { isAuthorized, limitRequest } from "@/lib/auth";

import { decryptConfig, encryptConfig } from "@/lib/crypto";
import { updateServerSchema } from "@/lib/validation";
import { normalizeLocationCode } from "@/lib/countries";
import { checkServerDuplicates } from "@/lib/duplicate-check";

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
  
  let rawConfig = "";
  try {
    rawConfig = decryptConfig(server.encryptedConfig);
  } catch {
    try {
      rawConfig = Buffer.from(server.encryptedConfig.cipherText, "base64").toString("utf8");
    } catch {
      rawConfig = server.encryptedConfig.cipherText ?? "";
    }
  }

  return NextResponse.json({ server, rawConfig });
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
    if (data.rawConfig !== undefined || data.host !== undefined || data.port !== undefined || data.protocol !== undefined) {
      const current = await getServer(id);
      if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const matches = await checkServerDuplicates([{
        id, name: data.name ?? current.name, protocol: data.protocol ?? current.protocol,
        host: data.host ?? current.host, port: data.port ?? current.port,
        rawConfig: data.rawConfig ?? decryptConfig(current.encryptedConfig),
      }], [id]);
      const duplicate = matches.find(match => match.kind === "duplicate");
      if (duplicate) return NextResponse.json({ error: `Duplicate server: matches ${duplicate.existing}`, duplicates: matches }, { status: 409 });
    }
    const safeCountry = data.country !== undefined
      ? normalizeLocationCode((data.country && data.country !== "XX" && data.country !== "GLOBAL") ? data.country : data.name)
      : undefined;

    const updateInput: Parameters<typeof updateServer>[1] = {
      name: data.name,
      protocol: data.protocol,
      host: data.host,
      port: data.port,
      country: safeCountry,
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
