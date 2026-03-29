import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServer, listServers } from "@/lib/db";
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
    const payload = await request.json();
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
