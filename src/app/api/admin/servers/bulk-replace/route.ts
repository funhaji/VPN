import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { replaceServers } from "@/lib/db";
import { encryptConfig } from "@/lib/crypto";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { detectProfileMetadata } from "@/lib/profile-import";
import { serverInputSchema } from "@/lib/validation";
import { normalizeLocationCode } from "@/lib/countries";
import { z } from "zod";

export const dynamic = "force-dynamic";

const revalidateServerCatalog = (): void => {
  revalidatePath("/api/servers");
};

const normalizeEndpoint = (
  input: { host?: string; port?: number; rawConfig: string },
): { host: string; port: number } => {
  if (input.host && input.port) {
    return { host: input.host, port: input.port };
  }

  const detected = detectProfileMetadata(input.rawConfig, "custom:tcp");
  const host = input.host ?? detected.host ?? "embedded-config";
  const portValue = input.port ?? detected.port ?? 443;
  const port = Number.isFinite(portValue) && portValue > 0 ? portValue : 443;
  return { host, port };
};

const bulkReplaceSchema = z.object({
  oldIds: z.array(z.string().uuid()).min(1),
  servers: z.array(serverInputSchema).min(1),
});

export async function POST(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const json = await request.json();
    const parsed = bulkReplaceSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { oldIds, servers } = parsed.data;

    const itemsToInsert = servers.map((data) => {
      const endpoint = normalizeEndpoint(data);
      const rawCountry = (data.country && data.country !== "XX" && data.country !== "GLOBAL")
        ? data.country
        : data.name;
      const safeCountry = normalizeLocationCode(rawCountry);
      return {
        id: randomUUID(),
        name: data.name,
        protocol: data.protocol,
        host: endpoint.host,
        port: endpoint.port,
        country: safeCountry,
        isEnabled: data.isEnabled,
        options: data.options,
        encryptedConfig: encryptConfig(data.rawConfig),
      };
    });

    const result = await replaceServers(oldIds, itemsToInsert);
    revalidateServerCatalog();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk replace failed" },
      { status: 500 },
    );
  }
}
