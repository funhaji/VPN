import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServer, createServers, deleteAllServers, listServers, setAllServersEnabled } from "@/lib/db";
import { encryptConfig } from "@/lib/crypto";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { detectProfileMetadata } from "@/lib/profile-import";
import { serverInputSchema } from "@/lib/validation";

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

export async function GET(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const servers = await listServers(false);
  return NextResponse.json({ servers });
}

export async function POST(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as { servers?: unknown[] } | unknown;
    if (typeof payload === "object" && payload && Array.isArray((payload as { servers?: unknown[] }).servers)) {
      const incoming = (payload as { servers: unknown[] }).servers;
      if (incoming.length === 0) {
        return NextResponse.json({ error: "Empty server list" }, { status: 400 });
      }
      const validServers = [];
      for (const item of incoming) {
        const parsedItem = serverInputSchema.safeParse(item);
        if (!parsedItem.success) {
          return NextResponse.json({ error: "Invalid payload in bulk list" }, { status: 400 });
        }
        validServers.push(parsedItem.data);
      }
      await createServers(
        validServers.map((data) => {
          const endpoint = normalizeEndpoint(data);
          return {
            id: randomUUID(),
            name: data.name,
            protocol: data.protocol,
            host: endpoint.host,
            port: endpoint.port,
            country: data.country,
            isEnabled: data.isEnabled,
            options: data.options,
            encryptedConfig: encryptConfig(data.rawConfig),
          };
        }),
      );
      revalidateServerCatalog();
      return NextResponse.json({ ok: true, count: validServers.length });
    }

    const parsed = serverInputSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const encryptedConfig = encryptConfig(parsed.data.rawConfig);
    const endpoint = normalizeEndpoint(parsed.data);
    await createServer({
      id: randomUUID(),
      name: parsed.data.name,
      protocol: parsed.data.protocol,
      host: endpoint.host,
      port: endpoint.port,
      country: parsed.data.country,
      isEnabled: parsed.data.isEnabled,
      options: parsed.data.options,
      encryptedConfig,
    });

    revalidateServerCatalog();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as { action?: unknown };
    const action = typeof payload.action === "string" ? payload.action : "";
    if (action !== "enable-all" && action !== "disable-all") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const changed = await setAllServersEnabled(action === "enable-all");
    revalidateServerCatalog();
    return NextResponse.json({ ok: true, changed });
  } catch {
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await deleteAllServers();
    revalidateServerCatalog();
    return NextResponse.json({ ok: true, deleted });
  } catch {
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}
