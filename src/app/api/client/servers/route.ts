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
      let runtimeProfile;
      try {
        runtimeProfile = buildRuntimeProfile(server, rawConfig);
      } catch (error) {
        runtimeProfile = {
          engine: "unsupported",
          supported: false,
          reason:
            error instanceof Error && error.message.trim()
              ? `Failed to build runtime metadata: ${error.message}`
              : "Failed to build runtime metadata for this server",
        };
      }

      return {
        id: server.id,
        name: server.name,
        protocol: server.protocol,
        host: server.host,
        port: server.port,
        country: server.country,
        options: server.options,
        rawConfig: "",
        runtimeProfile,
        updatedAt: server.updatedAt,
      };
    }),
  });
}
