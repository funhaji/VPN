import { NextRequest, NextResponse } from "next/server";
import { buildRuntimeProfile } from "@/app/api/servers/route";
import { isClientAuthorized, limitRequest } from "@/lib/auth";
import { decryptConfig } from "@/lib/crypto";
import { listServers } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!limitRequest(request)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isClientAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const servers = await listServers(true);
  return NextResponse.json({
    servers: servers.map((server) => {
      const rawConfig = decryptConfig(server.encryptedConfig);
      return {
        id: server.id,
        name: server.name,
        protocol: server.protocol,
        host: server.host,
        port: server.port,
        country: server.country,
        options: server.options,
        rawConfig: "",
        runtimeProfile: buildRuntimeProfile(server, rawConfig),
        updatedAt: server.updatedAt,
      };
    }),
  });
}
