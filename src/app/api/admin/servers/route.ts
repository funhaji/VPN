import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServer, createServers, listServers } from "@/lib/db";
import { encryptConfig } from "@/lib/crypto";
import { isAuthorized, limitRequest } from "@/lib/auth";
import { serverInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

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
          return {
            id: randomUUID(),
            name: data.name,
            protocol: data.protocol,
            host: data.host,
            port: data.port,
            country: data.country,
            isEnabled: data.isEnabled,
            options: data.options,
            encryptedConfig: encryptConfig(data.rawConfig),
          };
        }),
      );
      return NextResponse.json({ ok: true, count: validServers.length });
    }

    const parsed = serverInputSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const encryptedConfig = encryptConfig(parsed.data.rawConfig);
    await createServer({
      id: randomUUID(),
      name: parsed.data.name,
      protocol: parsed.data.protocol,
      host: parsed.data.host,
      port: parsed.data.port,
      country: parsed.data.country,
      isEnabled: parsed.data.isEnabled,
      options: parsed.data.options,
      encryptedConfig,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}
